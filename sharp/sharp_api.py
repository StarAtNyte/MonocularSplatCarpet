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
app = modal.App("sharp-api-myroom-v2")

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
    .pip_install([
        "fastapi",
        "uvicorn",
        "python-multipart",
        "ninja",
        "packaging",
        "wheel",
        "setuptools",
        "transformers",
        "timm",  # Required by transformers for vision models
        "accelerate"  # For faster model loading
    ])
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

def extract_camera_params(ply_path: Path) -> dict:
    """Extract camera parameters from Sharp PLY file."""
    from plyfile import PlyData

    ply_data = PlyData.read(str(ply_path))

    camera_params = {}

    # Extract intrinsics (3x3 matrix stored as 9 values)
    if 'intrinsic' in ply_data:
        intrinsic_data = ply_data['intrinsic']['intrinsic']
        # Reshape to 3x3 matrix: [f_px, 0, cx, 0, f_px, cy, 0, 0, 1]
        camera_params['intrinsics'] = {
            'fx': float(intrinsic_data[0]),
            'fy': float(intrinsic_data[4]),
            'cx': float(intrinsic_data[2]),
            'cy': float(intrinsic_data[5])
        }

    # Extract extrinsics (4x4 matrix stored as 16 values)
    if 'extrinsic' in ply_data:
        extrinsic_data = ply_data['extrinsic']['extrinsic']
        # 4x4 identity matrix - camera at origin looking down +Z
        camera_params['extrinsics'] = {
            'position': [0.0, 0.0, 0.0],
            'matrix': extrinsic_data.tolist()
        }

    # Extract image size
    if 'image_size' in ply_data:
        image_size_data = ply_data['image_size']['image_size']
        camera_params['image_size'] = {
            'width': int(image_size_data[0]),
            'height': int(image_size_data[1])
        }

    return camera_params

def map_2d_mask_to_gaussians_from_ply(floor_mask_2d, ply_path, camera_params):
    """Map a 2D floor mask to actual 3D Gaussians by projecting their positions.

    Args:
        floor_mask_2d: Binary floor mask at original image resolution (H x W), values 0-255
        ply_path: Path to the PLY file containing gaussian positions
        camera_params: Camera intrinsics and extrinsics for projection

    Returns:
        floor_gaussian_mask: Binary mask indicating which Gaussians are floor (num_actual_gaussians,)
    """
    import numpy as np
    from plyfile import PlyData

    try:
        # Read gaussian positions from PLY
        ply_data = PlyData.read(str(ply_path))
        vertex_data = ply_data['vertex']

        num_gaussians = len(vertex_data)
        print(f"Found {num_gaussians} gaussians in PLY file")

        # Extract positions (x, y, z)
        positions = np.stack([vertex_data['x'], vertex_data['y'], vertex_data['z']], axis=-1)

        # Validate camera params
        if not camera_params or 'intrinsics' not in camera_params or 'image_size' not in camera_params:
            print("WARNING: Missing camera params, using default projection")
            # Fallback: just mark all gaussians as non-floor
            return np.zeros(num_gaussians, dtype=bool)

        # Get camera intrinsics
        fx = camera_params['intrinsics']['fx']
        fy = camera_params['intrinsics']['fy']
        cx = camera_params['intrinsics']['cx']
        cy = camera_params['intrinsics']['cy']

        # Get image dimensions
        img_height = camera_params['image_size']['height']
        img_width = camera_params['image_size']['width']

        print(f"Camera intrinsics: fx={fx}, fy={fy}, cx={cx}, cy={cy}")
        print(f"Image size: {img_width}x{img_height}")
        print(f"Floor mask shape: {floor_mask_2d.shape}")

        # Project 3D positions to 2D image coordinates
        # For Sharp's coordinate system: camera at origin looking down +Z
        # Standard pinhole projection: u = fx * (x/z) + cx, v = fy * (y/z) + cy
        z = positions[:, 2]

        # Avoid division by zero
        valid_depth = z > 0.01  # Gaussians must be in front of camera

        u = fx * (positions[:, 0] / np.maximum(z, 0.01)) + cx
        v = fy * (positions[:, 1] / np.maximum(z, 0.01)) + cy

        # Convert to integer pixel coordinates
        u_px = np.round(u).astype(int)
        v_px = np.round(v).astype(int)

        # Check if pixels are within image bounds
        in_bounds = (u_px >= 0) & (u_px < img_width) & (v_px >= 0) & (v_px < img_height) & valid_depth

        # Create floor mask for gaussians
        floor_gaussian_mask = np.zeros(num_gaussians, dtype=bool)

        # For each gaussian, check if its projected pixel is floor
        for i in range(num_gaussians):
            if in_bounds[i]:
                # Check floor mask at projected pixel location
                is_floor = floor_mask_2d[v_px[i], u_px[i]] > 127  # Threshold at mid-gray
                floor_gaussian_mask[i] = is_floor

        print(f"Gaussians in bounds: {np.sum(in_bounds)} / {num_gaussians}")
        print(f"Floor gaussians: {np.sum(floor_gaussian_mask)} / {num_gaussians} ({100 * np.sum(floor_gaussian_mask) / num_gaussians:.1f}%)")

        return floor_gaussian_mask

    except Exception as e:
        print(f"ERROR in map_2d_mask_to_gaussians_from_ply: {e}")
        import traceback
        traceback.print_exc()
        # Return empty mask on error
        return np.zeros(len(ply_data['vertex']) if 'ply_data' in locals() else 0, dtype=bool)

@app.function(
    image=image,
    gpu="A100",  # Upgraded from T4 for higher quality processing
    volumes={CACHE_DIR: models_volume},
    timeout=600,  # 10 minutes should be enough
    container_idle_timeout=600  # Keep container alive for 10 minutes after last request
)
def process_image(image_bytes: bytes, render_video: bool = False):
    import torch
    import torch.nn.functional as F
    import torchvision.transforms as transforms
    from torchvision.models.segmentation import deeplabv3_mobilenet_v3_large
    from PIL import Image
    import io
    import numpy as np
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

        # Run floor segmentation with Mask2Former
        print("Loading segmentation model...")
        seg_start = time.time()

        from transformers import Mask2FormerImageProcessor, Mask2FormerForUniversalSegmentation
        import torch

        # Load Mask2Former model trained on ADE20K (150 classes including floor)
        processor = Mask2FormerImageProcessor.from_pretrained("facebook/mask2former-swin-large-ade-semantic")
        model = Mask2FormerForUniversalSegmentation.from_pretrained("facebook/mask2former-swin-large-ade-semantic")
        model.eval()
        model = model.to('cuda' if torch.cuda.is_available() else 'cpu')

        # Load image
        pil_image = Image.open(io.BytesIO(image_bytes)).convert('RGB')

        # Preprocess image
        inputs = processor(images=pil_image, return_tensors="pt")
        inputs = {k: v.to('cuda' if torch.cuda.is_available() else 'cpu') for k, v in inputs.items()}

        # Run segmentation
        with torch.no_grad():
            outputs = model(**inputs)

        # Post-process to get segmentation map
        segmentation = processor.post_process_semantic_segmentation(
            outputs, target_sizes=[pil_image.size[::-1]]
        )[0]

        # Convert to numpy
        seg_mask = segmentation.cpu().numpy().astype(np.uint8)

        # In ADE20K: floor is class 3, rug is class 28 (0-indexed)
        # ADE20K class mapping: 0=wall, 1=building, 2=sky, 3=floor, 4=tree, ..., 28=rug, etc.
        floor_classes = [3, 28]  # Floor and rug classes in ADE20K
        floor_mask = np.isin(seg_mask, floor_classes).astype(np.uint8) * 255

        # Save floor mask
        floor_mask_pil = Image.fromarray(floor_mask, mode='L')
        floor_mask_bytes_io = io.BytesIO()
        floor_mask_pil.save(floor_mask_bytes_io, format='PNG')
        floor_mask_bytes = floor_mask_bytes_io.getvalue()

        seg_end = time.time()
        print(f"⏱️ Segmentation time: {seg_end - seg_start:.2f}s")
        print(f"Floor+Rug pixels detected: {np.sum(floor_mask > 0)} / {floor_mask.size} ({100 * np.sum(floor_mask > 0) / floor_mask.size:.1f}%)")

        # Optional: Print unique classes detected for debugging
        unique_classes = np.unique(seg_mask)
        print(f"Detected classes: {unique_classes}")

        # NOTE: We'll map the floor mask AFTER getting the PLY file
        # since we need the actual gaussian positions and camera params

        # Construct command
        # sharp predict -i <input_dir> -o <output_dir>
        # Note: Removed --render flag to only generate splat files (much faster)
        cmd = ["sharp", "predict", "-i", input_dir, "-o", output_dir]
            
        print(f"Running command: {' '.join(cmd)}")
        
        inference_start = time.time()
        try:
            # Run sharp
            result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            print("Sharp stdout:", result.stdout)
            print("Sharp stderr:", result.stderr)
        except subprocess.CalledProcessError as e:
            print("Error running sharp:")
            print("STDOUT:", e.stdout)
            print("STDERR:", e.stderr)
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
        camera_params = None
        floor_gaussian_mask = None

        # Find PLY (Gaussian Splat)
        ply_files = list(Path(output_dir).glob("*.ply"))
        if ply_files:
            ply_path = ply_files[0]  # Assume one ply per image
            print(f"Found PLY: {ply_path}")
            with open(ply_path, "rb") as f:
                ply_bytes = f.read()

            # Extract camera parameters from PLY file
            camera_params = extract_camera_params(ply_path)
            print(f"Extracted camera parameters: {camera_params}")

            # Now map 2D floor mask to actual 3D Gaussians using their positions
            print("Mapping floor+rug mask to actual 3D Gaussians...")
            mapping_start = time.time()
            floor_gaussian_mask = map_2d_mask_to_gaussians_from_ply(
                floor_mask,
                ply_path,
                camera_params
            )
            mapping_end = time.time()
            print(f"⏱️ Floor+Rug-to-Gaussian mapping time: {mapping_end - mapping_start:.2f}s")
        else:
            raise RuntimeError("No PLY file found in output")
        
        end_time = time.time()
        print(f"⏱️ Total time: {end_time - start_time:.2f}s")
        print(f"   - Setup: {setup_time - start_time:.2f}s")
        print(f"   - Segmentation: {seg_end - seg_start:.2f}s")
        print(f"   - Inference: {inference_end - inference_start:.2f}s")
        print(f"   - File I/O: {end_time - inference_end:.2f}s")

        return {
            "ply": base64.b64encode(ply_bytes).decode('utf-8'),
            "floor_mask_2d": base64.b64encode(floor_mask_bytes).decode('utf-8'),
            "floor_mask_3d": floor_gaussian_mask.tolist(),
            "floor_coverage_2d": float(np.sum(floor_mask > 0) / floor_mask.size),
            "floor_coverage_3d": float(np.sum(floor_gaussian_mask) / len(floor_gaussian_mask)),
            "camera": camera_params,
            "gaussian_grid_info": {
                "total_gaussians": len(floor_gaussian_mask),
                "floor_rug_gaussians": int(np.sum(floor_gaussian_mask)),
                "note": "Sharp creates sparse gaussians, not a dense grid"
            }
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
            "description": "Monocular View Synthesis - Fast Splat Generation with 2D+3D Floor/Rug Segmentation",
            "version": "2.1.0",
            "endpoints": {
                "/predict": "POST - Upload an image to generate a 3D gaussian splat PLY file with 2D and 3D floor/rug segmentation"
            },
            "response_format": {
                "ply": "base64-encoded PLY file (3D Gaussian splat)",
                "floor_mask_2d": "base64-encoded PNG image (binary floor+rug mask at image resolution)",
                "floor_mask_3d": "boolean array mapping each Gaussian to floor/rug or not",
                "floor_coverage_2d": "float - percentage of image pixels identified as floor/rug (0.0 to 1.0)",
                "floor_coverage_3d": "float - percentage of Gaussians identified as floor/rug (0.0 to 1.0)",
                "camera": {
                    "intrinsics": {"fx": "float", "fy": "float", "cx": "float", "cy": "float"},
                    "extrinsics": {"position": "[x, y, z]", "matrix": "4x4 transformation matrix"},
                    "image_size": {"width": "int", "height": "int"}
                },
                "gaussian_grid_info": {
                    "total_gaussians": "int - total number of Gaussians in the splat (sparse, not a dense grid)",
                    "floor_rug_gaussians": "int - number of Gaussians identified as floor or rug"
                }
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

