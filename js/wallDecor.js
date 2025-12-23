import * as THREE from 'three';
import { GUI } from 'lil-gui';
import {
    viewer, wallDecor, wallDecorParams, wallDecorGui, wallGaussianPositions,
    wallGaussianBounds, wallClusters, activeWall, wallMaskData,
    setWallDecor, setWallDecorGui, setWallClusters, setActiveWall
} from './utils.js';
import { collectWallGaussians, clusterWallsByOrientation, findCameraFacingWall } from './wallDetection.js';

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
            wallDecorMesh.visible = wallDecorParams.visible;
            setWallDecor(wallDecorMesh);

            if (viewer.threeScene) {
                viewer.threeScene.add(wallDecorMesh);
            }

            resolve(wallDecorMesh);
        }, undefined, reject);
    });
}

export function placeWallDecorOnWall() {
    if (!wallDecor) return;

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

    if (wallClusters.length === 0) {
        console.log('Clustering walls by orientation...');
        const clusters = clusterWallsByOrientation(wallGaussianPositions, cameraPos);
        setWallClusters(clusters);

        if (clusters.length === 0) {
            console.warn('No wall clusters found, falling back to all gaussians');
            setWallClusters([{
                id: 0,
                normal: new THREE.Vector3(0, 0, 1),
                centroid: new THREE.Vector3(),
                gaussians: wallGaussianPositions,
                plane: null
            }]);
        }
    }

    const wall = findCameraFacingWall(wallClusters, cameraPos, cameraDir);
    setActiveWall(wall);

    if (!activeWall) {
        console.error('Could not determine camera-facing wall');
        return;
    }

    console.log(`Using Wall ${activeWall.id} with ${activeWall.gaussians.length} gaussians`);

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

    const surfaceCenter = new THREE.Vector3();
    for (const pos of surfaceGaussians) {
        surfaceCenter.add(pos);
    }
    surfaceCenter.divideScalar(surfaceGaussians.length);

    let position = surfaceCenter.clone();
    const wallNormal = activeWall.normal.clone();
    position.addScaledVector(wallNormal, 0.02);

    position.x += wallDecorParams.offsetX;
    position.y += wallDecorParams.offsetY;
    position.z += wallDecorParams.offsetZ;

    wallDecor.position.copy(position);

    const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
    const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, wallNormal);

    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    wallDecor.quaternion.copy(quaternion);

    wallDecor.scale.set(wallDecorParams.scale, wallDecorParams.scale, wallDecorParams.scale);
    wallDecor.visible = wallDecorParams.visible;

    console.log('✅ Wall decor placed successfully');
}

function updateWallDecorPosition() {
    if (!wallDecor || wallGaussianPositions.length === 0) return;

    const wallCenter = new THREE.Vector3();
    for (const pos of wallGaussianPositions) {
        wallCenter.add(pos);
    }
    wallCenter.divideScalar(wallGaussianPositions.length);

    const position = wallCenter.clone();
    position.x += wallDecorParams.offsetX;
    position.y += wallDecorParams.offsetY;
    position.z += wallDecorParams.offsetZ;

    if (wallGaussianBounds) {
        position.clamp(wallGaussianBounds.min, wallGaussianBounds.max);
    }

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
    hint.textContent = '💡 Click on any wall to move the decor there!';
    newWallDecorGui.domElement.appendChild(hint);
}

export function removeCurrentWallDecor() {
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
