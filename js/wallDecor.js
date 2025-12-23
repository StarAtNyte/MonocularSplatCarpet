import * as THREE from 'three';
import { GUI } from 'lil-gui';
import {
    viewer, wallDecor, wallDecorParams, wallDecorGui, wallGaussianPositions,
    wallGaussianBounds, wallClusters, activeWall, wallMaskData,
    setWallDecor, setWallDecorGui, setWallClusters, setActiveWall
} from './utils.js';
import { collectWallGaussians, clusterWallsByOrientation, findCameraFacingWall } from './wallDetection.js';
import { showWallMarkers, clearWallMarkers, raycastWallMarkers, highlightWallMarker, resetWallMarkerHighlights } from './wall-markers.js';

let isWallSelectionMode = false;

export function createWallDecor(textureUrl) {
    return new Promise((resolve, reject) => {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(textureUrl, (texture) => {
            if (wallDecor && viewer.threeScene) {
                viewer.threeScene.remove(wallDecor);
                wallDecor.geometry.dispose();
                wallDecor.material.dispose();
            }

            const decorWidth = 1.5;
            const aspectRatio = texture.image.height / texture.image.width;
            const decorHeight = decorWidth * aspectRatio;

            const decorDepth = 0.01;
            const geometry = new THREE.BoxGeometry(decorWidth, decorHeight, decorDepth);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true
            });

            const wallDecorMesh = new THREE.Mesh(geometry, material);
            // Start invisible until placed on a wall
            wallDecorMesh.visible = false;
            setWallDecor(wallDecorMesh);

            if (viewer.threeScene) {
                viewer.threeScene.add(wallDecorMesh);
            }

            resolve(wallDecorMesh);
        }, undefined, reject);
    });
}

export function placeWallDecorOnWall(selectedWall = null) {
    if (!wallDecor) return;

    // Collect gaussians if needed
    if (wallGaussianPositions.length === 0 && wallMaskData) {
        const collected = collectWallGaussians();
        if (!collected) {
            console.error('Failed to collect wall gaussians');
            return;
        }
    }

    if (wallGaussianPositions.length === 0) {
        console.error('No wall gaussians available');
        return;
    }

    const cameraPos = viewer.camera.position.clone();
    const cameraDir = new THREE.Vector3();
    viewer.camera.getWorldDirection(cameraDir);

    console.log('=== PLACING WALL DECOR ===');

    // Cluster walls if not already done
    if (wallClusters.length === 0) {
        console.log('Clustering walls by orientation...');
        const minWallWidth = 1.0; // Filter walls narrower than 1m
        const clusters = clusterWallsByOrientation(wallGaussianPositions, cameraPos, minWallWidth);
        setWallClusters(clusters);

        if (clusters.length === 0) {
            console.warn('No suitable wall clusters found');
            return;
        }
    }

    // Use provided wall or find camera-facing wall
    let wall = selectedWall;
    if (!wall) {
        wall = findCameraFacingWall(wallClusters, cameraPos, cameraDir);
    }
    setActiveWall(wall);

    if (!activeWall) {
        console.error('Could not determine wall for placement');
        return;
    }

    console.log(`Using Wall ${activeWall.id} with ${activeWall.gaussians.length} gaussians`);

    // Get surface gaussians (front layer)
    const wallGaussians = activeWall.gaussians;
    let minDist = Infinity;
    for (const pos of wallGaussians) {
        const dist = pos.distanceTo(cameraPos);
        if (dist < minDist) minDist = dist;
    }

    const threshold = 0.3;
    const surfaceGaussians = [];
    for (const pos of wallGaussians) {
        const dist = pos.distanceTo(cameraPos);
        if (dist <= minDist + threshold) {
            surfaceGaussians.push(pos);
        }
    }

    if (surfaceGaussians.length < 10) {
        console.error('Not enough surface gaussians found on active wall');
        return;
    }

    console.log(`Surface: ${surfaceGaussians.length} / ${wallGaussians.length} gaussians`);

    // Calculate surface center
    const surfaceCenter = new THREE.Vector3();
    for (const pos of surfaceGaussians) {
        surfaceCenter.add(pos);
    }
    surfaceCenter.divideScalar(surfaceGaussians.length);

    // Calculate the wall's local coordinate system for proper positioning
    const wallNormal = activeWall.normal.clone();
    const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
    const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

    // Position decor on the wall surface
    let position = surfaceCenter.clone();

    // Move along the wall's local coordinate system
    position.addScaledVector(right, wallDecorParams.offsetX);      // Horizontal movement along wall
    position.addScaledVector(up, wallDecorParams.offsetY);         // Vertical movement along wall
    position.addScaledVector(wallNormal, wallDecorParams.offsetZ); // Depth (away from wall)

    wallDecor.position.copy(position);

    // Orient decor to wall using the same coordinate system

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, wallNormal);

    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    wallDecor.quaternion.copy(quaternion);

    wallDecor.scale.set(wallDecorParams.scale, wallDecorParams.scale, wallDecorParams.scale);
    wallDecor.visible = wallDecorParams.visible;

    console.log('✅ Wall decor placed successfully');
}

export function startWallSelectionMode() {
    if (wallClusters.length === 0) {
        console.error('No wall clusters available. Detect walls first.');
        return false;
    }

    isWallSelectionMode = true;
    showWallMarkers();

    const status = document.getElementById('status');
    status.style.display = 'block';
    status.innerHTML = '<strong>🎯 Wall Selection Mode</strong><br>Click on a wall marker to place decor';

    console.log('📍 Wall selection mode activated');
    return true;
}

export function exitWallSelectionMode() {
    isWallSelectionMode = false;
    clearWallMarkers();

    const status = document.getElementById('status');
    status.style.display = 'none';

    console.log('Wall selection mode deactivated');
}

export function handleWallClick(event) {
    if (!isWallSelectionMode) return false;

    const selectedWall = raycastWallMarkers(event);
    if (selectedWall) {
        console.log(`✅ Wall ${selectedWall.id} selected`);

        // Reset offsets for new placement
        wallDecorParams.offsetX = 0;
        wallDecorParams.offsetY = 0;
        wallDecorParams.offsetZ = 0.02;

        // Place decor on selected wall
        placeWallDecorOnWall(selectedWall);

        // Exit selection mode
        exitWallSelectionMode();

        const status = document.getElementById('status');
        status.textContent = `Wall decor placed on Wall ${selectedWall.id}!`;
        setTimeout(() => { status.style.display = 'none'; }, 3000);

        return true;
    }

    return false;
}

// Mouse hover effects for wall markers
export function handleWallHover(event) {
    if (!isWallSelectionMode) return;

    const hoveredWall = raycastWallMarkers(event);
    resetWallMarkerHighlights();

    if (hoveredWall) {
        highlightWallMarker(hoveredWall.id);
        document.body.style.cursor = 'pointer';
    } else {
        document.body.style.cursor = 'default';
    }
}

function updateWallDecorPosition() {
    if (!wallDecor || !activeWall) return;

    // Calculate the wall's local coordinate system
    const wallNormal = activeWall.normal.clone();
    const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
    const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

    // Start at the wall's surface center
    const position = activeWall.centroid.clone();

    // Move along the wall's local coordinate system
    position.addScaledVector(right, wallDecorParams.offsetX);      // Horizontal movement along wall
    position.addScaledVector(up, wallDecorParams.offsetY);         // Vertical movement along wall
    position.addScaledVector(wallNormal, wallDecorParams.offsetZ); // Depth (away from wall)

    wallDecor.position.copy(position);
}

function updateWallDecor(skipPositionRecalc = false) {
    if (!skipPositionRecalc) {
        placeWallDecorOnWall();
    } else {
        if (!wallDecor) return;
        wallDecor.scale.set(wallDecorParams.scale, wallDecorParams.scale, wallDecorParams.scale);
        wallDecor.visible = wallDecorParams.visible;
    }
}

export function setupWallDecorGUI() {
    if (wallDecorGui) wallDecorGui.destroy();

    const newWallDecorGui = new GUI();
    newWallDecorGui.title('Wall Decor Controls');
    setWallDecorGui(newWallDecorGui);

    newWallDecorGui.add(wallDecorParams, 'visible').name('Visible').onChange(() => {
        if (wallDecor) {
            wallDecor.visible = wallDecorParams.visible;
        }
    });

    const posFolder = newWallDecorGui.addFolder('Position Offset');
    posFolder.add(wallDecorParams, 'offsetX', -3, 3, 0.01).name('X (horizontal)').onChange(() => updateWallDecorPosition());
    posFolder.add(wallDecorParams, 'offsetY', -3, 3, 0.01).name('Y (vertical)').onChange(() => updateWallDecorPosition());
    posFolder.add(wallDecorParams, 'offsetZ', -0.5, 0.5, 0.001).name('Z (depth)').onChange(() => updateWallDecorPosition());
    posFolder.open();

    const transformFolder = newWallDecorGui.addFolder('Transform');
    transformFolder.add(wallDecorParams, 'scale', 0.1, 10, 0.01).name('Scale').onChange(() => updateWallDecor(true));
    transformFolder.open();

    const hint = document.createElement('div');
    hint.style.cssText = 'padding: 8px; background: #1a2a1a; color: #90ee90; border-radius: 4px; font-size: 11px; margin-top: 8px; border: 1px solid #2a4a2a;';
    hint.textContent = '💡 Click "Select Wall" to choose a different wall!';
    newWallDecorGui.domElement.appendChild(hint);
}

export function removeCurrentWallDecor() {
    exitWallSelectionMode();

    if (wallDecor && viewer.threeScene) {
        viewer.threeScene.remove(wallDecor);
        if (wallDecor.geometry) wallDecor.geometry.dispose();
        if (wallDecor.material) {
            if (wallDecor.material.map) wallDecor.material.map.dispose();
            wallDecor.material.dispose();
        }
        setWallDecor(null);
    }

    if (wallDecorGui) {
        wallDecorGui.destroy();
        setWallDecorGui(null);
    }
}

// Arrow controls for wall decor positioning
let arrowControlsVisible = false;
let arrowHideTimeout = null;
const ARROW_HIDE_DELAY = 2000; // milliseconds

function updateArrowControlsPosition() {
    if (!wallDecor || !wallDecor.visible) {
        hideArrowControls();
        return;
    }

    const arrowControls = document.getElementById('wallDecorArrowControls');
    if (!arrowControls) return;

    // Convert 3D position to screen coordinates
    const vector = wallDecor.position.clone();
    vector.project(viewer.camera);

    const canvas = viewer.renderer.domElement;
    const widthHalf = canvas.clientWidth / 2;
    const heightHalf = canvas.clientHeight / 2;

    const x = (vector.x * widthHalf) + widthHalf;
    const y = -(vector.y * heightHalf) + heightHalf;

    arrowControls.style.left = `${x}px`;
    arrowControls.style.top = `${y}px`;
}

function showArrowControls() {
    if (!wallDecor || !wallDecor.visible) return;

    const arrowControls = document.getElementById('wallDecorArrowControls');
    if (!arrowControls) return;

    arrowControlsVisible = true;
    arrowControls.classList.add('visible');
    updateArrowControlsPosition();

    // Clear any existing timeout
    if (arrowHideTimeout) {
        clearTimeout(arrowHideTimeout);
        arrowHideTimeout = null;
    }
}

function hideArrowControls() {
    const arrowControls = document.getElementById('wallDecorArrowControls');
    if (!arrowControls) return;

    arrowControlsVisible = false;
    arrowControls.classList.remove('visible');
}

function scheduleHideArrowControls() {
    // Clear any existing timeout
    if (arrowHideTimeout) {
        clearTimeout(arrowHideTimeout);
    }

    // Schedule hiding the arrow controls
    arrowHideTimeout = setTimeout(() => {
        hideArrowControls();
        arrowHideTimeout = null;
    }, ARROW_HIDE_DELAY);
}

export function handleWallDecorHover(event) {
    if (!wallDecor || !wallDecor.visible || isWallSelectionMode) return;

    const canvas = viewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x, y }, viewer.camera);

    const intersects = raycaster.intersectObject(wallDecor, false);

    if (intersects.length > 0) {
        showArrowControls();
    } else if (arrowControlsVisible) {
        scheduleHideArrowControls();
    }
}

function moveWallDecor(direction) {
    if (!wallDecor || !activeWall) return;

    const moveAmount = 0.1; // meters per click along the wall plane

    // Adjust offsets based on direction (these are in wall's local coordinate system)
    switch (direction) {
        case 'up':
            wallDecorParams.offsetY += moveAmount;
            break;
        case 'down':
            wallDecorParams.offsetY -= moveAmount;
            break;
        case 'left':
            wallDecorParams.offsetX -= moveAmount;
            break;
        case 'right':
            wallDecorParams.offsetX += moveAmount;
            break;
    }

    // Update position (this will apply the offsets along the wall's local coordinate system)
    updateWallDecorPosition();
    updateArrowControlsPosition();
    showArrowControls(); // Keep visible when clicking
}

export function setupArrowControls() {
    const arrowControls = document.getElementById('wallDecorArrowControls');
    if (!arrowControls) return;

    // Add click handlers for arrow buttons
    const arrowButtons = arrowControls.querySelectorAll('.arrow-control-btn');
    arrowButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const direction = button.getAttribute('data-direction');
            moveWallDecor(direction);
        });

        // Keep controls visible when hovering over buttons
        button.addEventListener('mouseenter', () => {
            if (arrowHideTimeout) {
                clearTimeout(arrowHideTimeout);
                arrowHideTimeout = null;
            }
        });

        button.addEventListener('mouseleave', () => {
            scheduleHideArrowControls();
        });
    });

    // Keep controls visible when hovering over the container
    arrowControls.addEventListener('mouseenter', () => {
        if (arrowHideTimeout) {
            clearTimeout(arrowHideTimeout);
            arrowHideTimeout = null;
        }
    });

    arrowControls.addEventListener('mouseleave', () => {
        scheduleHideArrowControls();
    });

    // Update arrow position on camera move
    if (viewer.controls) {
        viewer.controls.addEventListener('change', () => {
            if (arrowControlsVisible) {
                updateArrowControlsPosition();
            }
        });
    }
}

export { isWallSelectionMode };