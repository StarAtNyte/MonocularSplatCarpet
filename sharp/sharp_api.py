
import modal
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import Response, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64

# Define the Modal App
app = modal.App("sharp-api-myroom")

# Define the image
image = (
    modal.Image.from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.13")
    .apt_install([
        "git",
        "ffmpeg",
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libsndfile1",
    ])
    .pip_install(["fastapi","uvicorn","python-multipart","ninja", "packaging", "wheel", "setuptools"])
    .add_local_file("requirements.txt", remote_path="/root/requirements.txt",copy=True)
    .run_commands(
        "sed -i '/^-e/d' /root/requirements.txt",
        "pip install -r /root/requirements.txt"
    )
    .add_local_dir(".", remote_path="/root/sharp", copy=True)
    .run_commands("cd /root/sharp && pip install -e .")
)

# Volume for caching models
# Torch Hub defaults to ~/.cache/torch/hub/checkpoints
models_volume = modal.Volume.from_name("sharp-models", create_if_missing=True)
CACHE_DIR = "/root/.cache/torch/hub/checkpoints"

@app.function(
    image=image,
    gpu="T4", 
    volumes={CACHE_DIR: models_volume},
    timeout=600,  # 10 minutes should be enough
    container_idle_timeout=600  # Keep container alive for 5 minutes after last request
)
def process_image(image_bytes: bytes, render_video: bool = False):
    import torch
    import time
    
    start_time = time.time()
    
    # Setup temporary directories
    with tempfile.TemporaryDirectory() as base_dir:
        input_dir = os.path.join(base_dir, "input")
        output_dir = os.path.join(base_dir, "output")
        os.makedirs(input_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        
        # Save input image
        input_path = os.path.join(input_dir, "input.jpg")
        with open(input_path, "wb") as f:
            f.write(image_bytes)
            
        print(f"Input image saved to {input_path}")
        setup_time = time.time()
        print(f"⏱️ Setup time: {setup_time - start_time:.2f}s")
        
        # Construct command
        # sharp predict -i <input_dir> -o <output_dir>
        # Note: Removed --render flag to only generate splat files (much faster)
        cmd = ["sharp", "predict", "-i", input_dir, "-o", output_dir]
            
        print(f"Running command: {' '.join(cmd)}")
        
        inference_start = time.time()
        try:
            # Run sharp
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except subprocess.CalledProcessError as e:
            print("Error running sharp:")
            print(e.stdout)
            print(e.stderr)
            raise RuntimeError(f"Sharp execution failed: {e.stderr}")
        
        inference_end = time.time()
        print(f"⏱️ Inference time: {inference_end - inference_start:.2f}s")
            
        # Check outputs
        # Sharp outputs gaussians to output_dir/*.ply
        # If --render, it outputs renderings to output_dir/renderings/*.mp4 (or similar)
        # We need to find the output files.
        
        output_files = list(Path(output_dir).glob("**/*"))
        print(f"Output files: {[f.relative_to(output_dir) for f in output_files]}")
        
        ply_bytes = None
        
        # Find PLY (Gaussian Splat)
        ply_files = list(Path(output_dir).glob("*.ply"))
        if ply_files:
            ply_path = ply_files[0]  # Assume one ply per image
            print(f"Found PLY: {ply_path}")
            with open(ply_path, "rb") as f:
                ply_bytes = f.read()
        else:
            raise RuntimeError("No PLY file found in output")
        
        end_time = time.time()
        print(f"⏱️ Total time: {end_time - start_time:.2f}s")
        print(f"   - Setup: {setup_time - start_time:.2f}s")
        print(f"   - Inference: {inference_end - inference_start:.2f}s")
        print(f"   - File I/O: {end_time - inference_end:.2f}s")
                
        return {
            "ply": base64.b64encode(ply_bytes).decode('utf-8')
        }

@app.function(
    image=image,
    allow_concurrent_inputs=True,
)
@modal.asgi_app()
def fastapi_app():
    app = FastAPI(title="Sharp API")
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def root():
        return {
            "name": "Sharp API",
            "description": "Monocular View Synthesis - Fast Splat Generation",
            "version": "1.0.0",
            "endpoints": {
                "/predict": "POST - Upload an image to generate a 3D gaussian splat PLY file"
            }
        }

    @app.post("/predict")
    async def predict_endpoint(file: UploadFile = File(...)):
        image_bytes = await file.read()
        
        # Check if file is image
        if not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="File must be an image")
            
        result = process_image.remote(image_bytes)
        return result
    
    return app
