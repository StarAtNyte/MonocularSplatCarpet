import * as THREE from 'three';

// ========== GLOBAL STATE ==========
// These variables are shared across modules

export let viewer = null;
export let rug = null;
export let wallDecor = null;
export let detectedPlane = null;
export let detectedWallPlane = null;
export let floorPlaneMesh = null;
export let floorPlaneVisible = false;
export let gui = null;
export let wallDecorGui = null;
export let customRugTexture = null;
export let splatLoaded = false;
export let isLoadingScene = false; // Prevents scene changes during loading
export let currentSplatPath = 'splats/room1';
export let lastCameraPosition = null;
export const cameraMovementThreshold = 0.5;

// API generated splat data
export let generatedSplatData = null;
export let floorMaskData = null;
export let wallMaskData = null;
export let floorOrientation = 'horizontal';
export let selectedImageFile = null;

// Camera lock state
export let cameraLocked = true;

// Initial camera state for fixed target
export const initialCameraState = {
    position: { x: 0, y: 0, z: 3 },
    lookAt: { x: 0, y: 0, z: 0 }
};

// Wall decor variables
export let detectedWalls = [];
export let wallGaussianPositions = [];
export let wallGaussianBounds = null;
export let wallClusters = [];
export let activeWall = null;
export let wallClusterHelpers = [];

// Raycaster and interaction state
export let raycaster = new THREE.Raycaster();
export let isDragging = false;
export let isRotating = false;
export let isResizing = false;
export let activeCorner = null;
export let offset = new THREE.Vector3();
export let previousMouse = { x: 0, y: 0 };
export let initialScale = 1;
export let initialDistance = 0;
export let oppositeCornerWorld = null;
export let draggedCornerWorld = null;
export let initialRugCenter = null;
export let gizmoRing = null;
export let gizmoHandle = null;
export let cornerHandles = [];
export let gizmoVisible = false;

// Parameters
export const wallDecorParams = {
    visible: true,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0.05, // 5cm forward from wall surface
    scale: 0.5,
    rotation: 0
};

export const rugParams = {
    visible: true,
    offsetX: 0,
    offsetY: 0.0,
    offsetZ: 0,
    rotation: 0,
    scale: 0.5,
    brightness: 1.0
};

// Setters for global state (to allow other modules to update these)
export function setViewer(v) { viewer = v; }
export function setRug(r) { rug = r; }
export function setWallDecor(w) { wallDecor = w; }
export function setDetectedPlane(p) { detectedPlane = p; }
export function setDetectedWallPlane(p) { detectedWallPlane = p; }
export function setFloorPlaneMesh(m) { floorPlaneMesh = m; }
export function setFloorPlaneVisible(v) { floorPlaneVisible = v; }
export function setGui(g) { gui = g; }
export function setWallDecorGui(g) { wallDecorGui = g; }
export function setCustomRugTexture(t) { customRugTexture = t; }
export function setSplatLoaded(l) { splatLoaded = l; }
export function setIsLoadingScene(l) { isLoadingScene = l; }
export function setCurrentSplatPath(p) { currentSplatPath = p; }
export function setLastCameraPosition(p) { lastCameraPosition = p; }
export function setGeneratedSplatData(d) { generatedSplatData = d; }
export function setFloorMaskData(d) { floorMaskData = d; }
export function setWallMaskData(d) { wallMaskData = d; }
export function setFloorOrientation(o) { floorOrientation = o; }
export function setSelectedImageFile(f) { selectedImageFile = f; }
export function setCameraLocked(l) { cameraLocked = l; }
export function setDetectedWalls(w) { detectedWalls = w; }
export function setWallGaussianPositions(p) { wallGaussianPositions = p; }
export function setWallGaussianBounds(b) { wallGaussianBounds = b; }
export function setWallClusters(c) { wallClusters = c; }
export function setActiveWall(w) { activeWall = w; }
export function setWallClusterHelpers(h) { wallClusterHelpers = h; }
export function setIsDragging(d) { isDragging = d; }
export function setIsRotating(r) { isRotating = r; }
export function setIsResizing(r) { isResizing = r; }
export function setActiveCorner(c) { activeCorner = c; }
export function setOffset(o) { offset = o; }
export function setPreviousMouse(m) { previousMouse = m; }
export function setInitialScale(s) { initialScale = s; }
export function setInitialDistance(d) { initialDistance = d; }
export function setOppositeCornerWorld(c) { oppositeCornerWorld = c; }
export function setDraggedCornerWorld(c) { draggedCornerWorld = c; }
export function setInitialRugCenter(c) { initialRugCenter = c; }
export function setGizmoRing(g) { gizmoRing = g; }
export function setGizmoHandle(h) { gizmoHandle = h; }
export function setCornerHandles(h) { cornerHandles = h; }
export function setGizmoVisible(v) { gizmoVisible = v; }

// ========== RAYCASTING HELPERS ==========

export function raycastMouseOnRug(event) {
    if (!rug) return null;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, viewer.camera);
    const intersects = raycaster.intersectObject(rug);
    return intersects.length > 0 ? intersects[0] : null;
}

export function raycastMouseOnWallDecor(event) {
    if (!wallDecor) return null;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, viewer.camera);
    const intersects = raycaster.intersectObject(wallDecor);
    return intersects.length > 0 ? intersects[0] : null;
}

// ========== PLANE FITTING ALGORITHMS ==========

/**
 * Fit a plane to floor gaussians using PCA (Principal Component Analysis)
 */
export function fitPlaneToFloorGaussians(floorPositions) {
    const n = floorPositions.length;
    if (n < 3) return null;

    // Calculate centroid
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const pos of floorPositions) {
        sumX += pos.x;
        sumY += pos.y;
        sumZ += pos.z;
    }
    const centroid = new THREE.Vector3(sumX / n, sumY / n, sumZ / n);

    // Build covariance matrix
    let xx = 0, xy = 0, xz = 0;
    let yy = 0, yz = 0, zz = 0;

    for (const pos of floorPositions) {
        const dx = pos.x - centroid.x;
        const dy = pos.y - centroid.y;
        const dz = pos.z - centroid.z;

        xx += dx * dx;
        xy += dx * dy;
        xz += dx * dz;
        yy += dy * dy;
        yz += dy * dz;
        zz += dz * dz;
    }

    xx /= n; xy /= n; xz /= n;
    yy /= n; yz /= n; zz /= n;

    // Find principal components using power iteration
    let pc1 = new THREE.Vector3(1, 0, 0);
    for (let iter = 0; iter < 20; iter++) {
        const x = xx * pc1.x + xy * pc1.y + xz * pc1.z;
        const y = xy * pc1.x + yy * pc1.y + yz * pc1.z;
        const z = xz * pc1.x + yz * pc1.y + zz * pc1.z;
        pc1.set(x, y, z).normalize();
    }

    let pc2 = new THREE.Vector3(0, 1, 0);
    pc2.sub(pc1.clone().multiplyScalar(pc2.dot(pc1))).normalize();

    for (let iter = 0; iter < 20; iter++) {
        const x = xx * pc2.x + xy * pc2.y + xz * pc2.z;
        const y = xy * pc2.x + yy * pc2.y + yz * pc2.z;
        const z = xz * pc2.x + yz * pc2.y + zz * pc2.z;
        pc2.set(x, y, z);
        pc2.sub(pc1.clone().multiplyScalar(pc2.dot(pc1))).normalize();
    }

    // The normal is perpendicular to both principal components
    const normal = new THREE.Vector3().crossVectors(pc1, pc2).normalize();

    // Orient normal to point toward camera
    const cameraPos = viewer.camera.position;
    const cameraUp = viewer.camera.up;
    const centroidToCamera = new THREE.Vector3().subVectors(cameraPos, centroid);

    const isInvertedY = cameraUp.y < 0;
    console.log('Camera coordinate system:', isInvertedY ? 'INVERTED (up=-Y)' : 'NORMAL (up=+Y)');

    if (normal.dot(centroidToCamera) < 0) {
        normal.negate();
    }

    if (isInvertedY) {
        console.log('Inverted Y detected - normal already oriented toward camera');
    }

    const d = -normal.dot(centroid);

    console.log('Fitted plane to', n, 'floor gaussians using PCA');
    console.log('Plane normal:', normal.toArray().map(v => v.toFixed(3)));
    console.log('Plane centroid:', centroid.toArray().map(v => v.toFixed(3)));
    console.log('Camera position:', cameraPos.toArray().map(v => v.toFixed(3)));

    return {
        normal: normal,
        centroid: centroid,
        d: d,
        inliers: n
    };
}

/**
 * Fit a plane to wall gaussians using PCA
 */
/**
 * Voxelize points for faster processing
 */
function voxelizePoints(positions, voxelSize = 0.1) {
    const voxelMap = new Map();

    for (const pos of positions) {
        const vx = Math.floor(pos.x / voxelSize);
        const vy = Math.floor(pos.y / voxelSize);
        const vz = Math.floor(pos.z / voxelSize);
        const key = `${vx},${vy},${vz}`;

        if (!voxelMap.has(key)) {
            voxelMap.set(key, []);
        }
        voxelMap.get(key).push(pos);
    }

    // Calculate voxel centroids
    const voxelCentroids = [];
    for (const points of voxelMap.values()) {
        const centroid = new THREE.Vector3();
        for (const p of points) {
            centroid.add(p);
        }
        centroid.divideScalar(points.length);
        voxelCentroids.push(centroid);
    }

    return voxelCentroids;
}

/**
 * Sample points if there are too many
 */
function samplePoints(positions, maxSamples = 2000) {
    if (positions.length <= maxSamples) return positions;

    const step = Math.floor(positions.length / maxSamples);
    const samples = [];
    for (let i = 0; i < positions.length; i += step) {
        samples.push(positions[i]);
        if (samples.length >= maxSamples) break;
    }
    return samples;
}

/**
 * Fast PCA plane fitting
 */
function fitPlanePCA(positions) {
    const n = positions.length;
    if (n < 3) return null;

    // Calculate centroid
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const pos of positions) {
        sumX += pos.x; sumY += pos.y; sumZ += pos.z;
    }
    const centroid = new THREE.Vector3(sumX / n, sumY / n, sumZ / n);

    // Build covariance matrix
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const pos of positions) {
        const dx = pos.x - centroid.x;
        const dy = pos.y - centroid.y;
        const dz = pos.z - centroid.z;
        xx += dx * dx; xy += dx * dy; xz += dx * dz;
        yy += dy * dy; yz += dy * dz; zz += dz * dz;
    }
    xx /= n; xy /= n; xz /= n; yy /= n; yz /= n; zz /= n;

    // Find principal components via power iteration
    let pc1 = new THREE.Vector3(1, 0, 0);
    for (let iter = 0; iter < 20; iter++) {
        pc1.set(
            xx * pc1.x + xy * pc1.y + xz * pc1.z,
            xy * pc1.x + yy * pc1.y + yz * pc1.z,
            xz * pc1.x + yz * pc1.y + zz * pc1.z
        ).normalize();
    }

    let pc2 = new THREE.Vector3(0, 1, 0);
    pc2.sub(pc1.clone().multiplyScalar(pc2.dot(pc1))).normalize();
    for (let iter = 0; iter < 20; iter++) {
        pc2.set(
            xx * pc2.x + xy * pc2.y + xz * pc2.z,
            xy * pc2.x + yy * pc2.y + yz * pc2.z,
            xz * pc2.x + yz * pc2.y + zz * pc2.z
        );
        pc2.sub(pc1.clone().multiplyScalar(pc2.dot(pc1))).normalize();
    }

    const normal = new THREE.Vector3().crossVectors(pc1, pc2).normalize();
    return { normal, centroid };
}

export function fitPlaneToWallGaussians(wallPositions, cameraPos) {
    if (wallPositions.length < 10) return null;

    const startTime = performance.now();

    // Sample large point sets for faster fitting
    const fittingPoints = samplePoints(wallPositions, 1500);

    // Adaptive threshold based on point density
    let distanceThreshold = 0.25;
    if (wallPositions.length > 1000) distanceThreshold = 0.2;
    else if (wallPositions.length < 100) distanceThreshold = 0.3;

    // Iterative outlier removal with early stopping
    let currentPoints = fittingPoints;
    let bestPlane = null;
    let previousInlierCount = 0;
    const maxIterations = 3;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const plane = fitPlanePCA(currentPoints);
        if (!plane) break;

        // Count inliers from current fitting set
        const threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.centroid);
        const inliers = currentPoints.filter(p => Math.abs(threePlane.distanceToPoint(p)) < distanceThreshold);
        const inlierRatio = inliers.length / currentPoints.length;

        bestPlane = plane;

        // Early stopping: excellent fit or converged
        if (inlierRatio > 0.95) break;
        if (iteration > 0 && Math.abs(inliers.length - previousInlierCount) < currentPoints.length * 0.01) break;

        previousInlierCount = inliers.length;
        currentPoints = inliers;
        if (currentPoints.length < 10) break;
    }

    if (!bestPlane) return null;

    // Ensure normal points toward camera
    const centroidToCamera = new THREE.Vector3().subVectors(cameraPos, bestPlane.centroid);
    if (bestPlane.normal.dot(centroidToCamera) < 0) {
        bestPlane.normal.negate();
    }

    const elapsed = performance.now() - startTime;
    if (wallPositions.length > 500) {
        console.log(`Fitted plane to ${wallPositions.length} points in ${elapsed.toFixed(1)}ms`);
    }

    return {
        normal: bestPlane.normal,
        centroid: bestPlane.centroid,
        d: -bestPlane.normal.dot(bestPlane.centroid),
        inliers: currentPoints.length
    };
}
