import * as THREE from 'three';
import * as GaussianSplats3D from 'https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js';
import {
    viewer, currentSplatPath, splatLoaded, rug, wallDecor,
    setViewer, setSplatLoaded, setFloorMaskData, setWallMaskData,
    setGeneratedSplatData, setCustomRugTexture, setDetectedPlane,
    setDetectedWallPlane, setFloorOrientation, rugParams, wallDecorParams,
    setWallGaussianPositions, setWallGaussianBounds, setWallClusters, setActiveWall,
    raycastMouseOnRug, raycastMouseOnWallDecor
} from './utils.js';
import { initializeUI } from './ui.js';
import { onRugMouseDown, onRugMouseMove, onRugMouseUp, removeCurrentRug } from './rug.js';
import { removeCurrentWallDecor, onWallDecorMouseDown, onWallDecorMouseMove, onWallDecorMouseUp } from './wallDecor.js';
import { loadSplatFromFolder } from './api.js';

// Track which object is currently being interacted with
let activeInteractionObject = null; // 'rug' or 'wallDecor' or null

// Cleanup scene function
// clearMaskData: if true, clears floor/wall mask data (use when loading NEW scene)
//                if false, keeps mask data (use when reloading same scene with same data)
export function cleanupScene(clearMaskData = true) {
    removeCurrentRug();
    removeCurrentWallDecor();

    // Reset state
    setDetectedPlane(null);
    setDetectedWallPlane(null);
    setCustomRugTexture(null);

    // Always clear computed wall state (these are derived from mask data)
    setWallGaussianPositions([]);
    setWallGaussianBounds(null);
    setWallClusters([]);
    setActiveWall(null);

    // Only clear raw mask data when switching to a new scene
    if (clearMaskData) {
        setFloorMaskData(null);
        setWallMaskData(null);
        console.log('Cleared wall mask data and computed wall state');
    } else {
        console.log('Cleared computed wall state (keeping mask data)');
    }

    // Reset params
    rugParams.visible = true;
    rugParams.offsetX = 0;
    rugParams.offsetY = 0.0;
    rugParams.offsetZ = 0;
    rugParams.rotation = 0;
    rugParams.scale = 0.5;

    wallDecorParams.visible = true;
    wallDecorParams.offsetX = 0;
    wallDecorParams.offsetY = 0;
    wallDecorParams.offsetZ = 0.05; // Match default
    wallDecorParams.rotation = 0;
    wallDecorParams.scale = 0.5;
}

// Initialize viewer
const viewerInstance = new GaussianSplats3D.Viewer({
    cameraUp: [0, -1, 0],
    initialCameraPosition: [-0.24324, -0.08784, 0.72614],
    initialCameraLookAt: [-0.24324, -0.08784, 4.05811],
    sphericalHarmonicsDegree: 2,
    sharedMemoryForWorkers: false,
    selfDrivenMode: true,
    useBuiltInControls: false,

});

setViewer(viewerInstance);

// Camera position lock system (works without built-in controls)
// These match the viewer's initial camera settings
const initialCameraPos = new THREE.Vector3(-0.24324, -0.08784, 0.72614);
const initialCameraLookAt = new THREE.Vector3(-0.24324, -0.08784, 4.05811);
let cameraResetPaused = false; // Pause during rug/wall manipulation

// Export function to pause/resume camera reset
window.pauseCameraReset = (pause) => {
    cameraResetPaused = pause;
};

// Monitor and reset camera position on every frame
function enforceCameraLock() {
    if (!cameraResetPaused) {
        const currentPos = viewerInstance.camera.position;
        const distance = currentPos.distanceTo(initialCameraPos);

        // If camera has moved significantly, smoothly return it to initial position
        if (distance > 0.01) {
            // Smooth interpolation back to initial position
            currentPos.lerp(initialCameraPos, 0.2);

            // Also reset camera lookAt
            const tempTarget = new THREE.Vector3();
            viewerInstance.camera.getWorldDirection(tempTarget);
            tempTarget.add(currentPos);

            const initialDir = initialCameraLookAt.clone().sub(initialCameraPos).normalize();
            const currentDir = tempTarget.clone().sub(currentPos).normalize();
            currentDir.lerp(initialDir, 0.2);

            const newLookAt = currentPos.clone().add(currentDir);
            viewerInstance.camera.lookAt(newLookAt);
        }
    }
    requestAnimationFrame(enforceCameraLock);
}
enforceCameraLock();

// Camera controls will be managed by UI (locked by default)
// Controls are disabled initially and can be toggled via debug panel

// Prevent context menu
viewerInstance.renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Initialize UI
initializeUI(cleanupScene);

// Load initial scene from folder
loadSplatFromFolder(currentSplatPath, cleanupScene)
    .then(() => {
        // Setup mouse event listeners
        const canvas = viewerInstance.renderer.domElement;

        // Combined mouse down handler
        canvas.addEventListener('mousedown', (event) => {
            // Check what's being clicked using raycasting
            const wallDecorIntersect = wallDecor ? raycastMouseOnWallDecor(event) : null;
            const rugIntersect = rug ? raycastMouseOnRug(event) : null;

            // Prioritize based on distance to camera (closer object gets priority)
            if (wallDecorIntersect && rugIntersect) {
                if (wallDecorIntersect.distance < rugIntersect.distance) {
                    activeInteractionObject = 'wallDecor';
                    onWallDecorMouseDown(event);
                } else {
                    activeInteractionObject = 'rug';
                    onRugMouseDown(event);
                }
            } else if (wallDecorIntersect) {
                activeInteractionObject = 'wallDecor';
                onWallDecorMouseDown(event);
            } else if (rugIntersect) {
                activeInteractionObject = 'rug';
                onRugMouseDown(event);
            } else {
                activeInteractionObject = null;
            }
        }, false);

        // Combined mouse move handler
        canvas.addEventListener('mousemove', (event) => {
            // If actively interacting with an object, only call that handler
            if (activeInteractionObject === 'wallDecor') {
                onWallDecorMouseMove(event);
            } else if (activeInteractionObject === 'rug') {
                onRugMouseMove(event);
            } else {
                // No active interaction - let both handlers run for hover effects
                const wallDecorHandled = onWallDecorMouseMove(event);
                if (!wallDecorHandled) {
                    onRugMouseMove(event);
                }
            }
        }, false);

        // Combined mouse up handler
        canvas.addEventListener('mouseup', (event) => {
            // Call the handler for the active object, then clear the active state
            if (activeInteractionObject === 'wallDecor') {
                onWallDecorMouseUp(event);
            } else if (activeInteractionObject === 'rug') {
                onRugMouseUp(event);
            } else {
                // No active object - try both
                const wallDecorHandled = onWallDecorMouseUp(event);
                if (!wallDecorHandled) {
                    onRugMouseUp(event);
                }
            }
            activeInteractionObject = null;
        }, false);

        console.log('Application initialized');
    })
    .catch(error => {
        console.error('Error loading initial scene:', error);
        const status = document.getElementById('status');
        status.textContent = `Error loading scene: ${error.message}`;
    });