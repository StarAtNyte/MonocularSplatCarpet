# Monocular Splat Carpet

A JavaScript web application for interactive rug and wall decor placement in 3D Gaussian Splatting (3DGS) scene generated from a single room image.

## Overview

This project provides a web-based interface to visualize and interact with room scenes generated via **SHARP** (Monocular View Synthesis). Users can upload a single image of a room, generate a high-quality splat scene, and then interactively place and manipulate rugs on the floor or frames/decor on the walls.

## Technical Architecture

### 1. SHARP Inference Pipeline & Semantic Tweaks
The core scene generation uses the **SHARP** (Monocular View Synthesis) model. To enable interactive placement, we modified the inference backend to perform a simultaneous semantic segmentation pass on the generated 3D geometry:
*   **2D Semantic Segmentation (MaskFormer)**: Before 3D generation, the input 2D image is processed through a **MaskFormer** backbone. This provides pixel-perfect masks for semantic categories (floor, walls, ceiling) in the source view.
*   **2D-to-3D Semantic Mapping**: During the monocular depth estimation and Gaussian initialization phase, we perform a **back-projection mapping**. Each generated Gaussian is projected back into the 2D camera plane of the input image. We then sample the MaskFormer segmentation map at that pixel location to assign a semantic identity to the 3D Gaussian.
*   **Dual-Head Inference**: The final model generates both 3D Gaussian parameters (XYZ, Opacity, Scaling, Rotation, SH) and a 1D refined semantic logit per Gaussian, initialized from the MaskFormer priors.
*   **Semantic Bitpacking**: To minimize network overhead for large scenes (often 500k+ Gaussians), semantic labels are bitpacked into uint8 arrays before transmission. This reduces the mask payload size by 8x compared to raw boolean arrays.
*   **Hybrid Compression**: The backend transmits a Gzipped PLY for the geometry and bitpacked masks for the semantics. The client-side `api.js` utilizes the browser's `DecompressionStream` API for non-blocking extraction.

### 2. Geometry & Advanced Plane Logic
The application processes the raw point cloud into interactable surfaces using spatial algorithms:

#### PCA Plane Fitting (Principal Component Analysis)
When mask data is available, we perform a precise structural fit:
1.  **Centroid Calculation**: Compute the mean $\mu$ of the specific Gaussian cluster (e.g., floor-labeled points).
2.  **Covariance Matrix**: Construct a $3 \times 3$ covariance matrix of the spatial coordinates.
3.  **Eigenvalue Decomposition via Power Iteration**: We use an iterative power method to find the principal components. The third principal component (corresponding to the smallest eigenvalue) defines the surface normal $\vec{n}$.
4.  **Iterative Outlier Removal**: To handle "floaters" or artifacts common in 3DGS, the fitting process runs for 3 iterations, discarding points beyond a dynamic distance threshold ($0.25m$) in each pass to refine the plane.

#### Voxelized Wall Clustering
Since a single room contains multiple wall planes (Front, Left, Right), we use a recursive spatial clustering algorithm:
*   **3D Voxelization**: Wall-labeled points are binned into a $0.3m$ grid.
*   **Flood-Fill Partitioning**: A 26-connectivity flood-fill algorithm groups adjacent voxels into discrete objects.
*   **Orientation Normalization**: For each cluster, we force the fitted normal to be horizontal ($\vec{n}_y = 0$) to ensure decor sits perfectly vertical, regardless of minor noise in the 3DGS depth estimation.

#### Coordinate System & Normal Orientation
3DGS models often use inverted coordinate systems (where $+Y$ is down). The engine automatically detects the `camera.up` vector and adjusts the PCA normal orientation to ensure it always faces the user, preventing "backface" placement of rugs and decor.

### 3. Interactive UX & Placement
*   **Z-Fighting Prevention**: Dynamic offsets are applied ($5cm$ for walls, $1.5cm$ for floors) to ensure assets render cleanly over the splat layer.
*   **Visual Gizmo**: A custom implementation using Three.js `RingGeometry` and `OctahedronGeometry` that translates 2D mouse deltas into 3D rotations and scales along the detected surface plane.

## Deployment

This is a vanilla JavaScript project with no build step. It uses ES6 modules and imports dependencies (like Three.js and JSZip) via a browser-native `importmap`.
