import * as THREE from 'three';
import { GUI } from 'lil-gui';
import {
    viewer, wallDecor, wallDecorParams, wallDecorGui, wallGaussianPositions,
    wallGaussianBounds, wallClusters, activeWall, wallMaskData,
    raycaster, isDragging, isRotating, isResizing, activeCorner,
    offset, previousMouse, initialScale, initialDistance,
    oppositeCornerWorld, draggedCornerWorld, initialRugCenter,
    setWallDecor, setWallDecorGui, setWallClusters, setActiveWall,
    setIsDragging, setIsRotating, setIsResizing, setActiveCorner,
    setPreviousMouse, setInitialScale, setInitialDistance,
    setOppositeCornerWorld, setDraggedCornerWorld, setInitialRugCenter,
    raycastMouseOnWallDecor
} from './utils.js';
import { collectWallGaussians, clusterWallsByOrientation, findCameraFacingWall } from './wallDetection.js';
import { showWallMarkers, clearWallMarkers, raycastWallMarkers, highlightWallMarker, resetWallMarkerHighlights } from './wall-markers.js';

let isWallSelectionMode = false;
let wallDecorGizmoRing = null;
let wallDecorGizmoHandle = null;
let wallDecorCornerHandles = [];
let wallDecorGizmoVisible = false;

// ========== GIZMO CREATION ==========

function createWallDecorGizmo() {
    if (!wallDecor) return;

    // Clean up old gizmos
    if (wallDecorGizmoRing) {
        viewer.threeScene.remove(wallDecorGizmoRing);
        wallDecorGizmoRing.geometry.dispose();
        wallDecorGizmoRing.material.dispose();
    }
    if (wallDecorGizmoHandle) {
        viewer.threeScene.remove(wallDecorGizmoHandle);
        wallDecorGizmoHandle.geometry.dispose();
        wallDecorGizmoHandle.material.dispose();
    }
    wallDecorCornerHandles.forEach(corner => {
        viewer.threeScene.remove(corner);
        corner.geometry.dispose();
        corner.material.dispose();
    });
    wallDecorCornerHandles = [];

    // Get wall decor dimensions
    const box = new THREE.Box3().setFromObject(wallDecor);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Calculate gizmo radius - make it fit INSIDE the frame
    // Use 80% of the smaller dimension to keep it within bounds
    const minDim = Math.min(size.x, size.y);
    const gizmoRadius = minDim * 0.4;  // 40% of smaller dimension = 80% diameter

    // Create rotation ring - single ring that fits inside the frame
    const ringThickness = 0.015;  // Thin ring
    const ringGeometry = new THREE.RingGeometry(
        gizmoRadius - ringThickness,
        gizmoRadius + ringThickness,
        64
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffaa00,  // Orange/yellow color
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false
    });
    wallDecorGizmoRing = new THREE.Mesh(ringGeometry, ringMaterial);
    wallDecorGizmoRing.userData.isGizmo = true;
    wallDecorGizmoRing.userData.isRotationGizmo = true;
    wallDecorGizmoRing.renderOrder = 999;
    viewer.threeScene.add(wallDecorGizmoRing);

    // No separate handle - the ring itself is the rotation control
    wallDecorGizmoHandle = null;

    // Create corner resize handles - at the actual corners/edges of the frame
    const cornerSize = 0.04;  // Visible but not too large
    const cornerGeometry = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize);
    const cornerMaterial = new THREE.MeshBasicMaterial({
        color: 0x0088ff,  // Blue color
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false
    });

    // Create 4 corner handles
    for (let i = 0; i < 4; i++) {
        const handle = new THREE.Mesh(cornerGeometry, cornerMaterial.clone());
        handle.userData.isCornerHandle = true;
        handle.userData.cornerIndex = i;
        handle.renderOrder = 999;
        viewer.threeScene.add(handle);
        wallDecorCornerHandles.push(handle);
    }

    updateWallDecorGizmo();
}

function updateWallDecorGizmo(show = true) {
    if (!wallDecorGizmoRing || !wallDecor || !wallDecor.visible) {
        if (wallDecorGizmoRing) wallDecorGizmoRing.visible = false;
        wallDecorCornerHandles.forEach(corner => corner.visible = false);
        wallDecorGizmoVisible = false;
        return;
    }

    wallDecorGizmoRing.visible = show;
    wallDecorCornerHandles.forEach(corner => corner.visible = show);
    wallDecorGizmoVisible = show;

    // Position gizmo ring at wall decor center
    wallDecorGizmoRing.position.copy(wallDecor.position);
    wallDecorGizmoRing.quaternion.copy(wallDecor.quaternion);

    // Get current scaled dimensions
    const box = new THREE.Box3().setFromObject(wallDecor);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Scale the ring to match the frame size
    // The ring should be 40% of the smaller dimension
    const minDim = Math.min(size.x, size.y);
    const targetRingDiameter = minDim * 0.8;  // 80% of smaller dimension

    // The ring was created with radius = minDim * 0.4 at initial scale
    // So we need to scale it proportionally to current size
    const currentScale = wallDecor.scale.x;  // Assuming uniform scale
    wallDecorGizmoRing.scale.setScalar(currentScale);

    // Position corner handles at the actual frame edges
    // size already includes the object's scale from Box3
    const halfWidth = size.x / 2;
    const halfHeight = size.y / 2;

    const cornerPositions = [
        new THREE.Vector3(-halfWidth, -halfHeight, 0), // bottom-left
        new THREE.Vector3(halfWidth, -halfHeight, 0),  // bottom-right
        new THREE.Vector3(halfWidth, halfHeight, 0),   // top-right
        new THREE.Vector3(-halfWidth, halfHeight, 0)   // top-left
    ];

    cornerPositions.forEach((localPos, index) => {
        const worldPos = localPos.clone();
        worldPos.applyQuaternion(wallDecor.quaternion);
        worldPos.add(wallDecor.position);
        wallDecorCornerHandles[index].position.copy(worldPos);
        // Also orient corners to face the camera
        wallDecorCornerHandles[index].quaternion.copy(wallDecor.quaternion);
    });
}

function findWallDecorGizmoIntersection(event) {
    if (!wallDecorGizmoRing || !wallDecor) return false;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, viewer.camera);
    const intersects = raycaster.intersectObjects([wallDecorGizmoRing], false);
    return intersects.length > 0;
}

function findWallDecorCornerIntersection(event) {
    if (!wallDecor || wallDecorCornerHandles.length === 0) return null;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, viewer.camera);
    const intersects = raycaster.intersectObjects(wallDecorCornerHandles, true);
    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && obj.userData.cornerIndex === undefined) {
            obj = obj.parent;
        }
        if (obj && obj.userData.cornerIndex !== undefined) {
            return obj.userData.cornerIndex;
        }
    }
    return null;
}

// ========== WALL DECOR CREATION AND PLACEMENT ==========

export function createWallDecor(textureUrl) {
    return new Promise((resolve, reject) => {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(textureUrl, (texture) => {
            if (wallDecor && viewer.threeScene) {
                viewer.threeScene.remove(wallDecor);
                wallDecor.geometry.dispose();
                wallDecor.material.dispose();
            }

            // Improve texture quality
            texture.anisotropy = viewer.renderer.capabilities.getMaxAnisotropy();
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;

            const decorWidth = 1.5;
            const aspectRatio = texture.image.height / texture.image.width;
            const decorHeight = decorWidth * aspectRatio;

            const decorDepth = 0.03;
            const geometry = new THREE.BoxGeometry(decorWidth, decorHeight, decorDepth);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true
            });

            const wallDecorMesh = new THREE.Mesh(geometry, material);
            wallDecorMesh.visible = false;
            setWallDecor(wallDecorMesh);

            if (viewer.threeScene) {
                viewer.threeScene.add(wallDecorMesh);
            }

            // Create gizmos
            createWallDecorGizmo();

            resolve(wallDecorMesh);
        }, undefined, reject);
    });
}

export function placeWallDecorOnWall(selectedWall = null) {
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

    // Initial camera position from viewer setup
    const initialCameraPos = new THREE.Vector3(0, 0, 3);
    const cameraPos = viewer.camera.position.clone();
    const cameraDir = new THREE.Vector3();
    viewer.camera.getWorldDirection(cameraDir);

    console.log('=== PLACING WALL DECOR ===');

    if (wallClusters.length === 0) {
        console.log('Clustering walls by orientation...');
        const minWallWidth = 1.0;
        const clusters = clusterWallsByOrientation(wallGaussianPositions, cameraPos, minWallWidth);
        setWallClusters(clusters);

        if (clusters.length === 0) {
            console.warn('No suitable wall clusters found');
            return;
        }
    }

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

    // Use the robust fitted plane from clustering
    const wallNormal = activeWall.normal.clone();
    const wallPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(wallNormal, activeWall.centroid);

    // Calculate wall bounds in 2D (along wall plane)
    const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
    const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

    // Project all gaussians onto wall's 2D coordinate system to find bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const pos of activeWall.gaussians) {
        const localPos = pos.clone().sub(activeWall.centroid);
        const x = localPos.dot(right);
        const y = localPos.dot(up);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    // Calculate center of wall in 2D, then convert back to 3D
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const wallCenter = activeWall.centroid.clone();
    wallCenter.addScaledVector(right, centerX);
    wallCenter.addScaledVector(up, centerY);

    console.log(`Wall bounds: width=${(maxX - minX).toFixed(2)}m, height=${(maxY - minY).toFixed(2)}m`);
    console.log(`Placing at wall center: [${wallCenter.x.toFixed(2)}, ${wallCenter.y.toFixed(2)}, ${wallCenter.z.toFixed(2)}]`);

    // Store this as the surface center for consistent positioning
    activeWall.surfaceCenter = wallCenter.clone();

    // Calculate distance from initial camera position to wall center
    const distanceFromInitialCamera = initialCameraPos.distanceTo(wallCenter);

    // Apply distance-based offset
    let autoOffsetZ = 0.06; // Default offset
    if (distanceFromInitialCamera > 10) {
        autoOffsetZ = 0.3;
    } else if (distanceFromInitialCamera > 8) {
        autoOffsetZ = 0.1;
    } else if (distanceFromInitialCamera > 5) {
        autoOffsetZ = 0.08;
    }

    console.log(`Distance from initial camera: ${distanceFromInitialCamera.toFixed(2)}m, applying offset: ${autoOffsetZ}m`);

    // Update offsetZ parameter with distance-based value
    wallDecorParams.offsetZ = autoOffsetZ;

    let position = wallCenter.clone();

    position.addScaledVector(right, wallDecorParams.offsetX);
    position.addScaledVector(up, wallDecorParams.offsetY);
    position.addScaledVector(wallNormal, wallDecorParams.offsetZ);

    wallDecor.position.copy(position);

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, wallNormal);

    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    wallDecor.quaternion.copy(quaternion);

    // Apply rotation parameter
    const rotationQuat = new THREE.Quaternion().setFromAxisAngle(wallNormal, wallDecorParams.rotation * Math.PI / 180);
    wallDecor.quaternion.premultiply(rotationQuat);

    wallDecor.scale.set(wallDecorParams.scale, wallDecorParams.scale, wallDecorParams.scale);
    wallDecor.visible = wallDecorParams.visible;

    updateWallDecorGizmo();

    console.log('Wall decor placed successfully');
}

// ========== WALL SELECTION MODE ==========

export function startWallSelectionMode() {
    if (wallClusters.length === 0) {
        console.error('No wall clusters available. Detect walls first.');
        return false;
    }

    isWallSelectionMode = true;
    showWallMarkers();

    const status = document.getElementById('status');
    status.style.display = 'block';
    status.innerHTML = '<strong>Wall Selection Mode</strong><br>Click on a wall marker to place decor';

    console.log('Wall selection mode activated');
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
        console.log(`Wall ${selectedWall.id} selected`);

        wallDecorParams.offsetX = 0;
        wallDecorParams.offsetY = 0;
        // offsetZ will be set automatically based on distance in placeWallDecorOnWall
        wallDecorParams.rotation = 0;

        placeWallDecorOnWall(selectedWall);

        exitWallSelectionMode();

        const status = document.getElementById('status');
        status.textContent = `Wall decor placed on Wall ${selectedWall.id}!`;
        setTimeout(() => { status.style.display = 'none'; }, 3000);

        return true;
    }

    return false;
}

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

// ========== POSITION UPDATE FUNCTIONS ==========

function updateWallDecorPosition() {
    if (!wallDecor || !activeWall) return;

    const wallNormal = activeWall.normal.clone();
    const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
    const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

    // Use surface center for consistent positioning (not centroid which includes wall depth)
    const position = (activeWall.surfaceCenter || activeWall.centroid).clone();

    position.addScaledVector(right, wallDecorParams.offsetX);
    position.addScaledVector(up, wallDecorParams.offsetY);
    position.addScaledVector(wallNormal, wallDecorParams.offsetZ);

    wallDecor.position.copy(position);
    updateWallDecorGizmo();
}

function updateWallDecor(skipPositionRecalc = false) {
    if (!skipPositionRecalc) {
        placeWallDecorOnWall();
    } else {
        if (!wallDecor || !activeWall) return;

        const wallNormal = activeWall.normal.clone();
        const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
        const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
        const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

        const matrix = new THREE.Matrix4();
        matrix.makeBasis(right, up, wallNormal);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
        wallDecor.quaternion.copy(quaternion);

        const rotationQuat = new THREE.Quaternion().setFromAxisAngle(wallNormal, wallDecorParams.rotation * Math.PI / 180);
        wallDecor.quaternion.premultiply(rotationQuat);

        wallDecor.scale.set(wallDecorParams.scale, wallDecorParams.scale, wallDecorParams.scale);
        wallDecor.visible = wallDecorParams.visible;
    }
    updateWallDecorGizmo();
}

// ========== MOUSE INTERACTION HANDLERS ==========

export function onWallDecorMouseDown(event) {
    if (!wallDecor || !wallDecor.visible || isWallSelectionMode) return false;

    // Check for corner resize handles
    const cornerIndex = findWallDecorCornerIntersection(event);
    if (cornerIndex !== null) {
        setIsResizing(true);
        setIsDragging(false);
        setIsRotating(false);
        setActiveCorner(cornerIndex);

        const box = new THREE.Box3().setFromObject(wallDecor);
        const size = new THREE.Vector3();
        box.getSize(size);
        // size already includes scale from Box3
        const halfWidth = size.x / 2;
        const halfHeight = size.y / 2;

        const cornerPositions = [
            new THREE.Vector3(-halfWidth, -halfHeight, 0),
            new THREE.Vector3(halfWidth, -halfHeight, 0),
            new THREE.Vector3(halfWidth, halfHeight, 0),
            new THREE.Vector3(-halfWidth, halfHeight, 0)
        ];

        const draggedCorner = cornerPositions[cornerIndex].clone();
        draggedCorner.applyQuaternion(wallDecor.quaternion);
        draggedCorner.add(wallDecor.position);
        setDraggedCornerWorld(draggedCorner);

        const oppositeIndex = (cornerIndex + 2) % 4;
        const oppositeCorner = cornerPositions[oppositeIndex].clone();
        oppositeCorner.applyQuaternion(wallDecor.quaternion);
        oppositeCorner.add(wallDecor.position);
        setOppositeCornerWorld(oppositeCorner);

        setInitialDistance(oppositeCornerWorld.distanceTo(draggedCornerWorld));
        setInitialScale(wallDecorParams.scale);
        setInitialRugCenter(wallDecor.position.clone());

        viewer.controls.enabled = false;
        viewer.renderer.domElement.style.cursor = 'nwse-resize';
        event.preventDefault();
        return true;
    }

    // Check for rotation gizmo
    if (findWallDecorGizmoIntersection(event)) {
        setIsRotating(true);
        setIsDragging(false);
        setIsResizing(false);
        setPreviousMouse({ x: event.clientX, y: event.clientY });
        viewer.controls.enabled = false;
        viewer.renderer.domElement.style.cursor = 'grabbing';
        event.preventDefault();
        return true;
    }

    // Check for dragging wall decor
    const intersect = raycastMouseOnWallDecor(event);
    if (intersect) {
        setIsDragging(true);
        setIsRotating(false);
        setIsResizing(false);

        const rect = viewer.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewer.camera);

        const wallPlane = new THREE.Plane();
        wallPlane.setFromNormalAndCoplanarPoint(activeWall.normal, wallDecor.position);

        const wallPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(wallPlane, wallPoint);

        if (wallPoint) {
            offset.copy(wallPoint).sub(wallDecor.position);
        } else {
            offset.copy(intersect.point).sub(wallDecor.position);
        }

        viewer.controls.enabled = false;
        viewer.renderer.domElement.style.cursor = 'grabbing';
        event.preventDefault();
        return true;
    }

    return false;
}

export function onWallDecorMouseMove(event) {
    if (!wallDecor || !wallDecor.visible) return false;

    if (isResizing) {
        const rect = viewer.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewer.camera);

        const wallPlane = new THREE.Plane();
        wallPlane.setFromNormalAndCoplanarPoint(activeWall.normal, wallDecor.position);

        const mouseWorldPos = new THREE.Vector3();
        raycaster.ray.intersectPlane(wallPlane, mouseWorldPos);

        if (mouseWorldPos) {
            const currentDistance = oppositeCornerWorld.distanceTo(mouseWorldPos);
            const scaleRatio = currentDistance / initialDistance;
            const newScale = Math.max(0.1, Math.min(10, initialScale * scaleRatio));
            wallDecorParams.scale = newScale;

            const newCenter = new THREE.Vector3().addVectors(oppositeCornerWorld, mouseWorldPos).multiplyScalar(0.5);

            const wallNormal = activeWall.normal.clone();
            const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
            const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
            const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

            // Calculate offset from surface center (not centroid)
            const surfaceRef = activeWall.surfaceCenter || activeWall.centroid;
            const centerToSurface = newCenter.clone().sub(surfaceRef);
            wallDecorParams.offsetX = centerToSurface.dot(right);
            wallDecorParams.offsetY = centerToSurface.dot(up);

            wallDecor.position.copy(newCenter);
            updateWallDecor(true);

            if (wallDecorGui) {
                wallDecorGui.controllersRecursive().forEach(controller => controller.updateDisplay());
            }
        }

        event.preventDefault();
        return true;
    } else if (isRotating) {
        const deltaX = previousMouse.x - event.clientX;
        wallDecorParams.rotation += deltaX;
        if (wallDecorParams.rotation < 0) wallDecorParams.rotation += 360;
        if (wallDecorParams.rotation >= 360) wallDecorParams.rotation -= 360;

        updateWallDecor(true);

        if (wallDecorGui) {
            wallDecorGui.controllersRecursive().forEach(controller => controller.updateDisplay());
        }

        setPreviousMouse({ x: event.clientX, y: event.clientY });
        event.preventDefault();
        return true;
    } else if (isDragging) {
        const rect = viewer.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewer.camera);

        const wallPlane = new THREE.Plane();
        wallPlane.setFromNormalAndCoplanarPoint(activeWall.normal, wallDecor.position);

        const mouseWorldPos = new THREE.Vector3();
        const intersected = raycaster.ray.intersectPlane(wallPlane, mouseWorldPos);

        if (intersected && mouseWorldPos) {
            const newPos = mouseWorldPos.clone().sub(offset);
            wallDecor.position.copy(newPos);

            const wallNormal = activeWall.normal.clone();
            const worldUp = new THREE.Vector3(0, viewer.camera.up.y < 0 ? -1 : 1, 0);
            const right = new THREE.Vector3().crossVectors(worldUp, wallNormal).normalize();
            const up = new THREE.Vector3().crossVectors(wallNormal, right).normalize();

            // Calculate offset from surface center (not centroid)
            const surfaceRef = activeWall.surfaceCenter || activeWall.centroid;
            const centerToSurface = newPos.clone().sub(surfaceRef);
            wallDecorParams.offsetX = centerToSurface.dot(right);
            wallDecorParams.offsetY = centerToSurface.dot(up);
            wallDecorParams.offsetZ = centerToSurface.dot(wallNormal);

            if (wallDecorGui) {
                wallDecorGui.controllersRecursive().forEach(controller => controller.updateDisplay());
            }

            updateWallDecorGizmo();
            event.preventDefault();
        }
        return true;
    } else {
        // Hover detection
        const cornerIndex = findWallDecorCornerIntersection(event);
        if (cornerIndex !== null) {
            updateWallDecorGizmo(true);
            viewer.renderer.domElement.style.cursor = 'nwse-resize';
            return true;
        } else if (findWallDecorGizmoIntersection(event)) {
            updateWallDecorGizmo(true);
            viewer.renderer.domElement.style.cursor = 'grab';
            return true;
        } else {
            const intersect = raycastMouseOnWallDecor(event);
            if (intersect) {
                updateWallDecorGizmo(true);
                viewer.renderer.domElement.style.cursor = 'move';
                return true;
            } else {
                updateWallDecorGizmo(false);
                viewer.renderer.domElement.style.cursor = 'default';
                return false;
            }
        }
    }

    return false;
}

export function onWallDecorMouseUp(event) {
    if (isDragging || isRotating || isResizing) {
        setIsDragging(false);
        setIsRotating(false);
        setIsResizing(false);
        setActiveCorner(null);
        setOppositeCornerWorld(null);
        setDraggedCornerWorld(null);
        setInitialRugCenter(null);
        viewer.controls.enabled = true;
        viewer.renderer.domElement.style.cursor = 'default';
        event.preventDefault();
        return true;
    }
    return false;
}

// ========== GUI SETUP ==========

export function setupWallDecorGUI() {
    if (wallDecorGui) wallDecorGui.destroy();

    const newWallDecorGui = new GUI();
    newWallDecorGui.title('Wall Decor Controls');
    setWallDecorGui(newWallDecorGui);

    newWallDecorGui.add(wallDecorParams, 'visible').name('Visible').onChange(() => {
        if (wallDecor) {
            wallDecor.visible = wallDecorParams.visible;
            updateWallDecorGizmo();
        }
    });

    const posFolder = newWallDecorGui.addFolder('Position Offset');
    posFolder.add(wallDecorParams, 'offsetX', -3, 3, 0.01).name('X (horizontal)').onChange(() => updateWallDecorPosition());
    posFolder.add(wallDecorParams, 'offsetY', -3, 3, 0.01).name('Y (vertical)').onChange(() => updateWallDecorPosition());
    posFolder.add(wallDecorParams, 'offsetZ', -0.5, 0.5, 0.001).name('Z (depth)').onChange(() => updateWallDecorPosition());
    posFolder.open();

    const transformFolder = newWallDecorGui.addFolder('Transform');
    transformFolder.add(wallDecorParams, 'scale', 0.1, 10, 0.01).name('Scale').onChange(() => updateWallDecor(true));
    transformFolder.add(wallDecorParams, 'rotation', 0, 360, 1).name('Rotation').onChange(() => updateWallDecor(true));
    transformFolder.open();

    // Add remove button
    const removeButton = { remove: () => removeCurrentWallDecor() };
    newWallDecorGui.add(removeButton, 'remove').name('🗑️ Remove Decor');

    const hint = document.createElement('div');
    hint.style.cssText = 'padding: 8px; background: #1a2a1a; color: #90ee90; border-radius: 4px; font-size: 11px; margin-top: 8px; border: 1px solid #2a4a2a;';
    hint.innerHTML = 'Drag to move<br> Drag orange handle to rotate<br> Drag blue corners to resize';
    newWallDecorGui.domElement.appendChild(hint);
}

// ========== CLEANUP ==========

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

    // Clean up gizmos
    if (wallDecorGizmoRing) {
        viewer.threeScene.remove(wallDecorGizmoRing);
        wallDecorGizmoRing.geometry.dispose();
        wallDecorGizmoRing.material.dispose();
        wallDecorGizmoRing = null;
    }
    if (wallDecorGizmoHandle) {
        viewer.threeScene.remove(wallDecorGizmoHandle);
        wallDecorGizmoHandle.geometry.dispose();
        wallDecorGizmoHandle.material.dispose();
        wallDecorGizmoHandle = null;
    }
    wallDecorCornerHandles.forEach(corner => {
        viewer.threeScene.remove(corner);
        corner.geometry.dispose();
        corner.material.dispose();
    });
    wallDecorCornerHandles = [];

    if (wallDecorGui) {
        wallDecorGui.destroy();
        setWallDecorGui(null);
    }
}

export { isWallSelectionMode };