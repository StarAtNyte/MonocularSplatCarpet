import {
    setSelectedImageFile, detectedWallPlane, wallDecorParams, viewer,
    splatLoaded, floorPlaneMesh, floorPlaneVisible,
    setFloorPlaneVisible, setCurrentSplatPath, setSplatLoaded,
    wallGaussianPositions, wallClusters, wallClusterHelpers,
    setWallClusterHelpers
} from './utils.js';
import { generateSplatFromImage, downloadGeneratedPLY, loadSplatFromFolder } from './api.js';
import { detectFloor, createFloorPlaneVisualization } from './floorDetection.js';
import { detectWall, collectWallGaussians, clusterWallsByOrientation } from './wallDetection.js';
import { placeRugAuto } from './rug.js';
import { createWallDecor, placeWallDecorOnWall, setupWallDecorGUI, removeCurrentWallDecor } from './wallDecor.js';
import * as THREE from 'three';

// Placeholder exports
export function populateRugGrid() {
    const grid = document.getElementById('rugGrid');
    grid.innerHTML = '';

    const rugs = [
        { name: 'Atlantede', path: 'assets/rugs/Atlantede.jpg' },
        { name: 'Easther', path: 'assets/rugs/Easther.jpg' },
        { name: 'Tappeto Classico', path: 'assets/rugs/Tappeto Classico.jpg' },
        { name: 'Tappeto Classico Sea Green', path: 'assets/rugs/Tappeto Classico Sea Green .jpg' },
        { name: 'Telerense', path: 'assets/rugs/Telerense.jpg' }
    ];

    rugs.forEach(rug => {
        const item = document.createElement('div');
        item.className = 'rug-item';
        item.innerHTML = `
            <img src="${rug.path}" alt="${rug.name}">
            <div class="rug-name">${rug.name}</div>
        `;
        item.addEventListener('click', () => selectRug(rug.path));
        grid.appendChild(item);
    });
}


export function populateWallDecorGrid() {
    const grid = document.getElementById('wallDecorGrid');
    grid.innerHTML = '';

    const wallDecors = [
        { name: 'Wall Decor 1', path: 'assets/wallDecors/wallDecor1.jpg' },
        { name: 'Wall Decor 2', path: 'assets/wallDecors/wallDecor2.jpg' },
        { name: 'Wall Decor 3', path: 'assets/wallDecors/wallDecor3.png' },
        { name: 'Wall Decor 4', path: 'assets/wallDecors/wallDecor4.png' },
        { name: 'Wall Decor 5', path: 'assets/wallDecors/wallDecor5.png' }
    ];

    wallDecors.forEach(decor => {
        const item = document.createElement('div');
        item.className = 'wall-decor-item';
        item.innerHTML = `
            <img src="${decor.path}" alt="${decor.name}">
            <div class="decor-name">${decor.name}</div>
        `;
        item.addEventListener('click', () => selectWallDecor(decor.path));
        grid.appendChild(item);
    });
}

export async function selectRug(rugPath) {
    const status = document.getElementById('status');

    // Highlight selected item
    document.querySelectorAll('.rug-item').forEach(item => {
        item.classList.remove('selected');
    });
    if (event && event.target) {
        const clickedItem = event.target.closest('.rug-item');
        if (clickedItem) clickedItem.classList.add('selected');
    }

    status.textContent = 'Loading rug...';
    status.style.display = 'block';

    try {
        // Place the rug
        await placeRugAuto(rugPath);

        // Close sidebar after selection
        document.getElementById('rugSidebar').classList.remove('open');
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
        console.error(error);
    }
}

export async function selectWallDecor(decorPath) {
    const status = document.getElementById('status');

    // Highlight selected item
    document.querySelectorAll('.wall-decor-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.closest('.wall-decor-item').classList.add('selected');

    // Remove old wall decor
    removeCurrentWallDecor();

    status.textContent = 'Detecting wall...';
    status.style.display = 'block';

    try {
        // Detect wall if not already detected
        if (!detectedWallPlane) {
            const wallDetected = await detectWall();
            if (!wallDetected) {
                return;
            }
        }

        // Create and place the wall decor
        status.textContent = 'Placing wall decor...';
        await createWallDecor(decorPath);

        // Reset offsets for new placement
        wallDecorParams.offsetX = 0;
        wallDecorParams.offsetY = 0;
        wallDecorParams.offsetZ = 0.02;

        placeWallDecorOnWall();

        setupWallDecorGUI();
        status.textContent = 'Wall decor placed! Drag to move.';

        // Close sidebar after selection
        document.getElementById('wallDecorSidebar').classList.remove('open');
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
        console.error(error);
    }
}

export function initializeUI(cleanupSceneFunc) {
    console.log('Initializing UI...');

    // Populate grids
    populateRugGrid();
    populateWallDecorGrid();

    // Splat select dropdown - load from folder
    document.getElementById('splatSelect').addEventListener('change', async (event) => {
        const selectedPath = event.target.value;
        const status = document.getElementById('status');

        status.style.display = 'block';
        status.textContent = 'Loading scene...';

        try {
            setCurrentSplatPath(selectedPath);
            await loadSplatFromFolder(selectedPath, cleanupSceneFunc);
        } catch (error) {
            console.error('Error loading splat:', error);
            status.textContent = `Error loading scene: ${error.message}`;
        }
    });

    // Generate splat event listeners
    document.getElementById('generateSplatInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            setSelectedImageFile(file);
            document.getElementById('generateSplatBtn').disabled = false;
            console.log('Image selected:', file.name);
        } else {
            setSelectedImageFile(null);
            document.getElementById('generateSplatBtn').disabled = true;
        }
    });

    document.getElementById('generateSplatBtn').addEventListener('click', async () => {
        const fileInput = document.getElementById('generateSplatInput');
        const selectedFile = fileInput.files[0];
        if (selectedFile) {
            await generateSplatFromImage(selectedFile, cleanupSceneFunc);
        }
    });

    document.getElementById('downloadPlyBtn').addEventListener('click', () => {
        downloadGeneratedPLY();
    });

    // Debug panel download button
    document.getElementById('debugDownloadPlyBtn').addEventListener('click', () => {
        downloadGeneratedPLY();
    });

    // Toggle floor plane button
    document.getElementById('toggleFloorBtn').addEventListener('click', async () => {
        const btn = document.getElementById('toggleFloorBtn');

        if (!floorPlaneMesh) {
            // Detect floor first
            const detected = await detectFloor();
            if (detected && floorPlaneMesh) {
                floorPlaneMesh.visible = true;
                setFloorPlaneVisible(true);
                btn.textContent = 'Hide Floor Plane';
            }
        } else {
            // Toggle visibility
            const newVisibility = !floorPlaneVisible;
            floorPlaneMesh.visible = newVisibility;
            setFloorPlaneVisible(newVisibility);
            btn.textContent = newVisibility ? 'Hide Floor Plane' : 'Show Floor Plane';
        }
    });

    // Toggle wall button
    document.getElementById('toggleWallBtn').addEventListener('click', async () => {
        await detectWall();
    });

    // Show wall clusters button
    document.getElementById('showWallClustersBtn').addEventListener('click', async () => {
        const btn = document.getElementById('showWallClustersBtn');
        const status = document.getElementById('status');

        // Toggle visibility if clusters already exist
        if (wallClusterHelpers.length > 0) {
            const areVisible = wallClusterHelpers[0].visible;
            wallClusterHelpers.forEach(helper => helper.visible = !areVisible);
            btn.textContent = areVisible ? 'Show Wall Clusters' : 'Hide Wall Clusters';
            return;
        }

        // Otherwise, create clusters
        status.style.display = 'block';
        status.textContent = 'Clustering walls...';

        if (wallGaussianPositions.length === 0) {
            const collected = collectWallGaussians();
            if (!collected) {
                status.textContent = 'No wall gaussians available!';
                return;
            }
        }

        const cameraPos = viewer.camera.position.clone();
        const clusters = clusterWallsByOrientation(wallGaussianPositions, cameraPos);

        if (clusters.length === 0) {
            status.textContent = 'No wall clusters found!';
            return;
        }

        // Visualize clusters
        const helpers = [];
        const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];

        clusters.forEach((cluster, i) => {
            const color = colors[i % colors.length];
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(cluster.gaussians.length * 3);

            cluster.gaussians.forEach((pos, j) => {
                positions[j * 3] = pos.x;
                positions[j * 3 + 1] = pos.y;
                positions[j * 3 + 2] = pos.z;
            });

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const material = new THREE.PointsMaterial({ color, size: 0.05 });
            const points = new THREE.Points(geometry, material);

            viewer.threeScene.add(points);
            helpers.push(points);
        });

        setWallClusterHelpers(helpers);
        btn.textContent = 'Hide Wall Clusters';
        status.innerHTML = `<strong>${clusters.length} wall clusters visualized!</strong>`;
    });

    // Open rug sidebar
    document.getElementById('openRugBtn').addEventListener('click', () => {
        document.getElementById('rugSidebar').classList.add('open');
    });

    // Close rug sidebar
    document.getElementById('closeRugBtn').addEventListener('click', () => {
        document.getElementById('rugSidebar').classList.remove('open');
    });

    // Open wall decor sidebar
    document.getElementById('openWallDecorBtn').addEventListener('click', () => {
        document.getElementById('wallDecorSidebar').classList.add('open');
    });

    // Close wall decor sidebar
    document.getElementById('closeWallDecorBtn').addEventListener('click', () => {
        document.getElementById('wallDecorSidebar').classList.remove('open');
    });

    // Custom rug upload
    document.getElementById('customRugInput').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                await selectRug(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    });

    // Custom wall decor upload
    document.getElementById('customWallDecorInput').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                await selectWallDecor(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    });

    // Camera lock/unlock functionality
    let cameraLocked = true; // Camera is locked by default

    // Set camera to locked on initialization
    if (viewer.controls) {
        viewer.controls.enabled = false;
        viewer.controls.enableRotate = false;
        viewer.controls.enableZoom = false;
        viewer.controls.enablePan = false;
    }

    // Camera lock/unlock button
    document.getElementById('cameraLockBtn').addEventListener('click', () => {
        const btn = document.getElementById('cameraLockBtn');
        cameraLocked = !cameraLocked;

        if (viewer.controls) {
            viewer.controls.enabled = !cameraLocked;
            viewer.controls.enableRotate = !cameraLocked;
            viewer.controls.enableZoom = !cameraLocked;
            viewer.controls.enablePan = !cameraLocked;
        }

        btn.textContent = cameraLocked ? 'Unlock Camera' : 'Lock Camera';
        console.log(`Camera ${cameraLocked ? 'locked' : 'unlocked'}`);
    });

    // Keyboard shortcut to hide/show controls
    document.addEventListener('keydown', (event) => {
        if (event.key === 'h' || event.key === 'H') {
            const controls = document.getElementById('controls');
            const instructions = document.getElementById('instructions');
            const isVisible = controls.style.display !== 'none';
            controls.style.display = isVisible ? 'none' : 'flex';
            instructions.style.display = isVisible ? 'none' : 'block';
        }

        // Secret hotkey combination: Ctrl+Shift+D to toggle debug panel
        if (event.ctrlKey && event.shiftKey && event.key === 'D') {
            event.preventDefault();
            const debugPanel = document.getElementById('debugPanel');
            const isVisible = debugPanel.style.display !== 'none';
            debugPanel.style.display = isVisible ? 'none' : 'block';
            console.log(`Debug panel ${isVisible ? 'hidden' : 'shown'}`);
        }
    });

    console.log('UI fully initialized');
}
