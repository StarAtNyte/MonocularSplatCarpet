import * as THREE from 'three';
import * as GaussianSplats3D from 'https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js';
import {
    viewer, currentSplatPath, splatLoaded,
    setViewer, setSplatLoaded, setFloorMaskData, setWallMaskData,
    setGeneratedSplatData, setCustomRugTexture, setDetectedPlane,
    setDetectedWallPlane, setFloorOrientation, rugParams, wallDecorParams,
    setWallGaussianPositions, setWallGaussianBounds, setWallClusters, setActiveWall
} from './utils.js';
import { initializeUI } from './ui.js';
import { onRugMouseDown, onRugMouseMove, onRugMouseUp, removeCurrentRug } from './rug.js';
import { removeCurrentWallDecor, onWallDecorMouseDown, onWallDecorMouseMove, onWallDecorMouseUp } from './wallDecor.js';
import { loadSplatFromFolder } from './api.js';

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

    // Only clear mask data when switching to a new scene
    if (clearMaskData) {
        setFloorMaskData(null);
        setWallMaskData(null);
        // Clear wall detection state
        setWallGaussianPositions([]);
        setWallGaussianBounds(null);
        setWallClusters([]);
        setActiveWall(null);
        console.log('Cleared wall mask data and clusters');
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
    initialCameraPosition: [0, 0, 3],
    initialCameraLookAt: [0, 0, 0],
    sphericalHarmonicsDegree: 2,
    sharedMemoryForWorkers: false,
    selfDrivenMode: true
});

setViewer(viewerInstance);

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
            // Try wall decor first (it will return false if not applicable)
            const wallDecorHandled = onWallDecorMouseDown(event);
            if (!wallDecorHandled) {
                // If wall decor didn't handle it, try rug
                onRugMouseDown(event);
            }
        }, false);

        // Combined mouse move handler
        canvas.addEventListener('mousemove', (event) => {
            // Try wall decor first
            const wallDecorHandled = onWallDecorMouseMove(event);
            if (!wallDecorHandled) {
                // If wall decor didn't handle it, try rug
                onRugMouseMove(event);
            }
        }, false);

        // Combined mouse up handler
        canvas.addEventListener('mouseup', (event) => {
            // Try both (they check their own state)
            const wallDecorHandled = onWallDecorMouseUp(event);
            if (!wallDecorHandled) {
                onRugMouseUp(event);
            }
        }, false);

        console.log('Application initialized');
    })
    .catch(error => {
        console.error('Error loading initial scene:', error);
        const status = document.getElementById('status');
        status.textContent = `Error loading scene: ${error.message}`;
    });