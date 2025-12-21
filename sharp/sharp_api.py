
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

def map_2d_mask_to_gaussians(floor_mask_2d, original_shape, internal_shape=(1536, 1536), stride=2):
    """Map a 2D floor mask to 3D Gaussian indices.

    Args:
        floor_mask_2d: Binary floor mask at original image resolution (H x W), values 0-255
        original_shape: Tuple of (height, width) of original image
        internal_shape: Tuple of (height, width) of Sharp's internal processing resolution
        stride: Stride used by Sharp to downsample when creating Gaussians (default=2)

    Returns:
        floor_gaussian_mask: Binary mask indicating which Gaussians are floor (num_gaussians,)
    """
    import torch
    import torch.nn.functional as F

    # Convert floor mask to tensor and ensure it's binary (0 or 1)
    floor_mask_tensor = torch.from_numpy(floor_mask_2d).float() / 255.0  # Normalize to [0, 1]
    floor_mask_tensor = floor_mask_tensor.unsqueeze(0).unsqueeze(0)  # Add batch and channel dims [1, 1, H, W]

    # Resize floor mask to Sharp's internal processing resolution (1536x1536)
    # Use nearest neighbor to preserve binary nature
    floor_mask_resized = F.interpolate(
        floor_mask_tensor,
        size=(internal_shape[1], internal_shape[0]),
        mode='nearest'
    )

    # Downsample to Gaussian grid resolution using max pooling
    # This ensures we capture floor regions - if any pixel in a stride×stride block is floor, mark it as floor
    gaussian_grid_height = internal_shape[1] // stride
    gaussian_grid_width = internal_shape[0] // stride

    floor_gaussian_grid = F.max_pool2d(
        floor_mask_resized,
        kernel_size=stride,
        stride=stride
    )  # Shape: [1, 1, 768, 768] for default settings

    # Flatten to match Gaussian ordering
    # Sharp creates Gaussians in a grid, with multiple layers
    # Each spatial position has num_layers Gaussians (default=2)
    floor_gaussian_mask = floor_gaussian_grid.squeeze()  # Shape: [768, 768]

    # Flatten to 1D mask
    floor_gaussian_mask_1d = floor_gaussian_mask.flatten()  # Shape: [768*768]

    # Convert to boolean mask (threshold at 0.5)
    floor_gaussian_mask_bool = floor_gaussian_mask_1d > 0.5

    return floor_gaussian_mask_bool.cpu().numpy()

@app.function(
    image=image,
    gpu="T4",
    volumes={CACHE_DIR: models_volume},
    timeout=600,  # 10 minutes should be enough
    container_idle_timeout=600  # Keep container alive for 5 minutes after last request
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

        # Map 2D floor+rug mask to 3D Gaussians
        print("Mapping floor+rug mask to 3D Gaussians...")
        mapping_start = time.time()

        # Sharp processes at 1536x1536 internal resolution with stride=2
        # This creates a 768x768 grid of Gaussians
        # Sharp uses num_layers=2, so each spatial position has 2 Gaussians
        floor_gaussian_mask_single_layer = map_2d_mask_to_gaussians(
            floor_mask,
            original_shape=pil_image.size[::-1],  # (height, width)
            internal_shape=(1536, 1536),
            stride=2
        )

        # Replicate for both layers (Sharp uses 2 layers by default)
        # Gaussians are ordered as: [layer0_gaussians, layer1_gaussians]
        # Each layer has 768*768 gaussians
        num_layers = 2
        floor_gaussian_mask = np.tile(floor_gaussian_mask_single_layer, num_layers)

        mapping_end = time.time()
        print(f"⏱️ Floor+Rug-to-Gaussian mapping time: {mapping_end - mapping_start:.2f}s")
        print(f"Floor+Rug Gaussians: {np.sum(floor_gaussian_mask)} / {len(floor_gaussian_mask)} ({100 * np.sum(floor_gaussian_mask) / len(floor_gaussian_mask):.1f}%)")

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
        camera_params = None

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
                "num_layers": num_layers,
                "grid_resolution": [768, 768],  # internal_shape / stride
                "floor_rug_gaussians": int(np.sum(floor_gaussian_mask))
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
            "version": "2.0.0",
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
                    "total_gaussians": "int - total number of Gaussians in the splat",
                    "num_layers": "int - number of depth layers (default: 2)",
                    "grid_resolution": "[width, height] - spatial resolution of Gaussian grid",
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
