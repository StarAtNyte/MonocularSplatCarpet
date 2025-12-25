import * as THREE from 'three';
import { GUI } from 'lil-gui';
import {
    viewer, rug, detectedPlane, gui, rugParams, gizmoRing, gizmoHandle,
    cornerHandles, gizmoVisible, raycaster, isDragging, isRotating, isResizing,
    activeCorner, offset, previousMouse, initialScale, initialDistance,
    oppositeCornerWorld, draggedCornerWorld, initialRugCenter, generatedSplatData,
    lastCameraPosition, cameraMovementThreshold, wallDecor,
    setRug, setGui, setGizmoRing, setGizmoHandle, setCornerHandles,
    setGizmoVisible, setIsDragging, setIsRotating, setIsResizing,
    setActiveCorner, setPreviousMouse, setInitialScale, setInitialDistance,
    setOppositeCornerWorld, setDraggedCornerWorld, setInitialRugCenter,
    setLastCameraPosition, raycastMouseOnRug, raycastMouseOnWallDecor
} from './utils.js';
import { detectFloor } from './floorDetection.js';


// ========== HELPER FUNCTIONS ==========

function placeRugOnHorizontalFloor(plane, cameraPos, cameraDir) {
    // Project camera view onto the floor plane for better placement
    console.log('Placing rug on floor plane (projection-based)');

    // Create plane and project camera looking direction onto it
    const floorPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.centroid);

    // Cast a ray from camera in the looking direction and find where it hits the floor
    const rayOrigin = cameraPos.clone();
    const rayDir = cameraDir.clone().normalize();
    const rayTarget = new THREE.Vector3();
    const ray = new THREE.Ray(rayOrigin, rayDir);

    let position;
    if (ray.intersectPlane(floorPlane, rayTarget)) {
        // Check if intersection is in front of camera
        const directionToTarget = rayTarget.clone().sub(cameraPos);
        const dotProduct = directionToTarget.dot(rayDir);

        if (dotProduct < 0) {
            // Intersection is behind camera (ray pointing away from floor)
            const defaultDistance = 2.0;
            const targetPoint = cameraPos.clone().add(rayDir.clone().multiplyScalar(defaultDistance));
            position = floorPlane.projectPoint(targetPoint, new THREE.Vector3());
            console.log(`Ray intersection behind camera, placed ${defaultDistance}m in front instead`);
        } else {
            // Use the intersection point, but limit the distance to keep rug close
            const distanceToIntersection = cameraPos.distanceTo(rayTarget);
            const maxDistance = 2.5; // Maximum 3.0 meters from camera

            if (distanceToIntersection > maxDistance) {
                // Place at fixed distance along camera direction, then project to floor
                const targetPoint = cameraPos.clone().add(rayDir.clone().multiplyScalar(maxDistance));
                position = floorPlane.projectPoint(targetPoint, new THREE.Vector3());
                console.log(`Rug placed at clamped distance (${maxDistance}m) from camera`);
            } else {
                position = rayTarget.clone();
                console.log('Rug placed at camera ray intersection with floor');
            }
        }
    } else {
        // Fallback: project camera position down onto floor
        position = floorPlane.projectPoint(cameraPos, new THREE.Vector3());

        // Check if the projected position is behind the camera
        const directionToRug = position.clone().sub(cameraPos);
        const dotProduct = directionToRug.dot(rayDir);

        if (dotProduct < 0) {
            // Rug is behind camera, place it in front instead
            const defaultDistance = 2.0; // 2.0 meters in front
            const targetPoint = cameraPos.clone().add(rayDir.clone().multiplyScalar(defaultDistance));
            position = floorPlane.projectPoint(targetPoint, new THREE.Vector3());
            console.log(`Rug was behind camera, placed ${defaultDistance}m in front instead`);
        } else {
            console.log('Rug placed at camera projection onto floor');
        }
    }

    // Add small offset along floor normal to place rug slightly above the floor plane
    const rugHeightOffset = 0.001; // 0.1 cm above the detected floor plane (prevents Z-fighting)
    position.add(plane.normal.clone().multiplyScalar(rugHeightOffset));

    console.log('Rug position:', position);

    // Store this as the reference position for consistent updates
    plane.referencePosition = position.clone();

    position.x += rugParams.offsetX;
    position.y += rugParams.offsetY;
    position.z += rugParams.offsetZ;

    rug.position.copy(position);

    const up = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, plane.normal);
    rug.quaternion.copy(quaternion);

    const rotationQuat = new THREE.Quaternion().setFromAxisAngle(plane.normal, rugParams.rotation * Math.PI / 180);
    rug.quaternion.premultiply(rotationQuat);

    rug.scale.set(rugParams.scale, rugParams.scale, rugParams.scale);
    rug.visible = rugParams.visible;
}

function placeRugOnWall(plane, cameraPos, cameraDir) {
    const wallPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.centroid);

    // Project camera position onto wall plane
    let position = wallPlane.projectPoint(cameraPos, new THREE.Vector3());

    // Store as reference position
    plane.referencePosition = position.clone();

    const autoZOffset = -0.04;
    position.z += autoZOffset;

    position.x += rugParams.offsetX;
    position.y += rugParams.offsetY;
    position.z += rugParams.offsetZ;

    rug.position.copy(position);

    const up = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, plane.normal);
    rug.quaternion.copy(quaternion);

    const rotationQuat = new THREE.Quaternion().setFromAxisAngle(plane.normal, rugParams.rotation * Math.PI / 180);
    rug.quaternion.premultiply(rotationQuat);

    rug.scale.set(rugParams.scale, rugParams.scale, rugParams.scale);
    rug.visible = rugParams.visible;
}

function updateRugPosition() {
    if (!rug || !detectedPlane) return;

    const plane = detectedPlane;
    // Use reference position from initial placement (not centroid)
    const position = (plane.referencePosition || plane.centroid).clone();

    position.x += rugParams.offsetX;
    position.y += rugParams.offsetY;
    position.z += rugParams.offsetZ;

    rug.position.copy(position);
    updateGizmo();
}

function updateRug(skipPositionRecalc = false) {
    if (!skipPositionRecalc) {
        placeRugOnFloor();
    } else {
        if (!rug || !detectedPlane) return;

        const plane = detectedPlane;
        const up = new THREE.Vector3(0, 0, 1);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, plane.normal);
        rug.quaternion.copy(quaternion);

        const rotationQuat = new THREE.Quaternion().setFromAxisAngle(plane.normal, rugParams.rotation * Math.PI / 180);
        rug.quaternion.premultiply(rotationQuat);

        rug.scale.set(rugParams.scale, rugParams.scale, rugParams.scale);
        rug.visible = rugParams.visible;

        // Update brightness
        if (rug.material) {
            rug.material.color.setRGB(rugParams.brightness, rugParams.brightness, rugParams.brightness);
        }
    }
    updateGizmo();
}

function updateGizmo(show = true) {
    if (!gizmoRing || !gizmoHandle || !rug || !rug.visible) {
        if (gizmoRing) gizmoRing.visible = false;
        if (gizmoHandle) gizmoHandle.visible = false;
        cornerHandles.forEach(corner => corner.visible = false);
        setGizmoVisible(false);
        return;
    }

    gizmoRing.visible = show;
    gizmoHandle.visible = show;
    cornerHandles.forEach(corner => corner.visible = show);
    setGizmoVisible(show);
}

function findGizmoIntersection(event) {
    if (!gizmoRing || !gizmoHandle || !rug) return false;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, viewer.camera);
    const intersects = raycaster.intersectObjects([gizmoRing, gizmoHandle], false);
    return intersects.length > 0;
}

function findCornerIntersection(event) {
    if (!rug || cornerHandles.length === 0) return null;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, viewer.camera);
    const intersects = raycaster.intersectObjects(cornerHandles, true);
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

// ========== MAIN EXPORTED FUNCTIONS ==========

export function createRug(textureUrl) {
    return new Promise((resolve, reject) => {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(textureUrl, (texture) => {
            if (rug && viewer.threeScene) {
                viewer.threeScene.remove(rug);
                rug.geometry.dispose();
                rug.material.dispose();
            }

            // Cleanup old gizmo
            if (gizmoRing) {
                gizmoRing.geometry.dispose();
                gizmoRing.material.dispose();
                setGizmoRing(null);
            }
            if (gizmoHandle) {
                gizmoHandle.geometry.dispose();
                gizmoHandle.material.dispose();
                setGizmoHandle(null);
            }

            // Determine orientation based on image aspect ratio
            const textureAspect = texture.image.width / texture.image.height;
            let rugWidth, rugHeight;

            // Base the sizing on a standard "long side" of 2.5 units (~8-10 feet in typical splat scale)
            // This ensures the rug geometry matches the image aspect ratio perfectly
            if (textureAspect >= 1) {
                // Landscape image
                rugWidth = 2.5;
                rugHeight = 2.5 / textureAspect;
            } else {
                // Portrait image
                rugWidth = 2.5 * textureAspect;
                rugHeight = 2.5;
            }

            // Improve texture quality (Matches MyRoomHelper)
            if (viewer && viewer.renderer) {
                texture.anisotropy = viewer.renderer.capabilities.getMaxAnisotropy();
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;

            // Use BoxGeometry instead of PlaneGeometry to give the rug thickness/depth
            const rugDepth = 0.022; // User preferred thickness
            const geometry = new THREE.BoxGeometry(rugWidth, rugHeight, rugDepth);

            // Offset geometry so the pivot (0,0,0) is at the bottom center of the rug
            // This makes placement and rotation much more intuitive
            geometry.translate(0, 0, rugDepth / 2);

            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.FrontSide, // FrontSide is enough for BoxGeometry
                transparent: true,
                color: new THREE.Color(rugParams.brightness, rugParams.brightness, rugParams.brightness)
            });

            const rugMesh = new THREE.Mesh(geometry, material);
            rugMesh.visible = rugParams.visible;
            setRug(rugMesh);

            // Create 3D gizmo as child of rug
            const smallerDim = Math.min(rugWidth, rugHeight);
            const ringRadius = smallerDim * 0.25;
            const tubeRadius = 0.012; // Slightly thinner tube
            // Lower height above the rug surface to reduce perspective distortion
            // Surface is at Z=rugDepth now
            const gizmoHeight = rugDepth + 0.01;

            // Darker steel color for visibility
            const steelColor = 0x4a4a4a;

            // Create ring gizmo
            const ringGeometry = new THREE.TorusGeometry(ringRadius, tubeRadius, 8, 48);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: steelColor,
                transparent: true,
                opacity: 0.8,
                depthTest: false,
                depthWrite: false
            });
            const gizmoRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
            gizmoRingMesh.renderOrder = 999;
            gizmoRingMesh.position.set(0, 0, gizmoHeight);
            gizmoRingMesh.visible = false;
            setGizmoRing(gizmoRingMesh);

            // Create diamond handle at the bottom of the ring for rotation indicator
            const handleGeometry = new THREE.OctahedronGeometry(0.06, 0);
            const handleMaterial = new THREE.MeshBasicMaterial({
                color: steelColor,
                transparent: true,
                opacity: 0.9,
                depthTest: false,
                depthWrite: false
            });
            const gizmoHandleMesh = new THREE.Mesh(handleGeometry, handleMaterial);
            gizmoHandleMesh.renderOrder = 1000;
            gizmoHandleMesh.position.set(0, -ringRadius, gizmoHeight); // At bottom of ring
            gizmoHandleMesh.scale.set(1.5, 1, 0.6); // Flatten to diamond shape
            gizmoHandleMesh.visible = false;
            setGizmoHandle(gizmoHandleMesh);

            // Create corner resize handles
            const newCornerHandles = [];
            // Just slightly above the rug top surface
            const cornerZ = rugDepth + 0.005;
            const cornerPositions = [
                { x: rugWidth / 2, y: rugHeight / 2 },   // Top-right
                { x: -rugWidth / 2, y: rugHeight / 2 },  // Top-left
                { x: -rugWidth / 2, y: -rugHeight / 2 }, // Bottom-left
                { x: rugWidth / 2, y: -rugHeight / 2 }   // Bottom-right
            ];

            const handleSize = 0.08;
            const outlineThickness = 0.01;

            const outlineGeometry = new THREE.BoxGeometry(
                handleSize + outlineThickness * 2,
                handleSize + outlineThickness * 2,
                0.01
            );
            const outlineMaterial = new THREE.MeshBasicMaterial({
                color: 0x000000,
                depthTest: false,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const cornerGeometry = new THREE.BoxGeometry(handleSize, handleSize, 0.01);
            const cornerMaterial = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                depthTest: false,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            cornerPositions.forEach((pos, index) => {
                const cornerGroup = new THREE.Group();
                cornerGroup.position.set(pos.x, pos.y, cornerZ);
                cornerGroup.visible = false;
                cornerGroup.userData.cornerIndex = index;

                const outline = new THREE.Mesh(outlineGeometry, outlineMaterial.clone());
                outline.renderOrder = 999;
                cornerGroup.add(outline);

                const fill = new THREE.Mesh(cornerGeometry, cornerMaterial.clone());
                fill.position.z = 0.006;
                fill.renderOrder = 1000;
                cornerGroup.add(fill);

                newCornerHandles.push(cornerGroup);
                rugMesh.add(cornerGroup);
            });
            setCornerHandles(newCornerHandles);

            rugMesh.add(gizmoRingMesh);
            rugMesh.add(gizmoHandleMesh);

            if (viewer.threeScene) {
                viewer.threeScene.add(rugMesh);
            }

            resolve(rugMesh);
        }, undefined, reject);
    });
}

export function placeRugOnFloor() {
    if (!rug || !detectedPlane) return;

    const plane = detectedPlane;

    // Get camera position and forward direction
    const cameraPos = viewer.camera.position.clone();
    const cameraDir = new THREE.Vector3();
    viewer.camera.getWorldDirection(cameraDir);

    // Detect if this is a vertical plane (wall) based on normal
    const isVerticalPlane = Math.abs(plane.normal.y) < 0.3;

    if (isVerticalPlane) {
        console.log('Placing rug on VERTICAL surface (wall)');
        placeRugOnWall(plane, cameraPos, cameraDir);
    } else {
        console.log('Placing rug on HORIZONTAL surface (floor)');
        placeRugOnHorizontalFloor(plane, cameraPos, cameraDir);
    }

    // Debug logging
    console.log('Rug placed! Properties:');
    console.log('  - Position:', rug.position);
    console.log('  - Visible:', rug.visible);
    console.log('  - Scale:', rug.scale);
    console.log('  - In scene:', viewer.threeScene.children.includes(rug));
}

export function setupRugGUI() {
    if (gui) gui.destroy();

    const newGui = new GUI();
    newGui.title('Rug Controls');
    setGui(newGui);

    newGui.add(rugParams, 'visible').name('Visible').onChange(() => {
        if (rug) {
            rug.visible = rugParams.visible;
            updateGizmo(rugParams.visible);
        }
    });

    newGui.add(rugParams, 'rotation', 0, 360, 1).name('Rotation (°)').onChange(() => updateRug(true));
    newGui.add(rugParams, 'scale', 0.1, 10, 0.01).name('Scale').onChange(() => updateRug(true));
    newGui.add(rugParams, 'brightness', 0.1, 2.0, 0.01).name('Brightness').onChange(() => updateRug(true));

    // Add remove button
    const removeButton = { remove: () => removeCurrentRug() };
    newGui.add(removeButton, 'remove').name('🗑️ Remove Rug');

    // Stack GUI controls after creating this one
    requestAnimationFrame(() => {
        const guiElements = Array.from(document.querySelectorAll('.lil-gui.root'));
        let currentTop = 20;
        const gap = 12;
        guiElements.forEach((gui) => {
            gui.style.top = currentTop + 'px';
            const height = gui.offsetHeight;
            currentTop += height + gap;
        });

        // Add click listener to title bar for collapse/expand
        const titleBar = newGui.domElement.querySelector('.title');
        if (titleBar) {
            titleBar.addEventListener('click', () => {
                setTimeout(() => {
                    const guiElements = Array.from(document.querySelectorAll('.lil-gui.root'));
                    let currentTop = 20;
                    const gap = 12;
                    guiElements.forEach((gui) => {
                        gui.style.top = currentTop + 'px';
                        const height = gui.offsetHeight;
                        currentTop += height + gap;
                    });
                }, 50);
            });
        }
    });
}

export function removeCurrentRug() {
    // Remove rug if exists
    if (rug && viewer.threeScene) {
        viewer.threeScene.remove(rug);
        if (rug.geometry) rug.geometry.dispose();
        if (rug.material) {
            if (rug.material.map) rug.material.map.dispose();
            rug.material.dispose();
        }
        setRug(null);
    }

    // Destroy GUI if exists
    if (gui) {
        gui.destroy();
        setGui(null);
    }

    // Clear gizmo
    if (gizmoRing) {
        gizmoRing.geometry.dispose();
        gizmoRing.material.dispose();
        setGizmoRing(null);
    }
    if (gizmoHandle) {
        gizmoHandle.geometry.dispose();
        gizmoHandle.material.dispose();
        setGizmoHandle(null);
    }
    // Clear corner handles
    cornerHandles.forEach(cornerGroup => {
        cornerGroup.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    });
    setCornerHandles([]);
    setGizmoVisible(false);

    // Restack remaining GUI controls
    requestAnimationFrame(() => {
        const guiElements = Array.from(document.querySelectorAll('.lil-gui.root'));
        let currentTop = 20;
        const gap = 12;
        guiElements.forEach((gui) => {
            gui.style.top = currentTop + 'px';
            const height = gui.offsetHeight;
            currentTop += height + gap;
        });
    });
}

export async function placeRugAuto(rugTextureUrl) {
    const status = document.getElementById('status');

    // Check if camera has moved significantly since last rug placement
    const currentCameraPos = viewer.camera.position.clone();
    let cameraMoved = false;

    if (lastCameraPosition) {
        const distance = currentCameraPos.distanceTo(lastCameraPosition);
        cameraMoved = distance > cameraMovementThreshold;
        console.log('Camera movement distance:', distance, 'Threshold:', cameraMovementThreshold, 'Moved:', cameraMoved);
    }

    // Save current rug's actual world position before removing (not offsets!)
    // Only save if camera hasn't moved significantly
    const savedPosition = (rug && !cameraMoved) ? rug.position.clone() : null;
    const savedParams = (rug && !cameraMoved) ? {
        rotation: rugParams.rotation,
        scale: rugParams.scale
    } : null;

    // Remove old rug if exists
    removeCurrentRug();

    status.textContent = 'Detecting floor...';
    status.style.display = 'block';

    try {
        // First detect the floor (only if not already detected)
        if (!detectedPlane) {
            const floorDetected = await detectFloor();
            if (!floorDetected) {
                return;
            }
        }

        // Then create and place the rug
        status.textContent = 'Placing rug...';
        await createRug(rugTextureUrl);

        // Restore saved parameters if replacing an existing rug AND camera hasn't moved
        if (savedPosition && savedParams) {
            // Place rug at exact same world position
            rug.position.copy(savedPosition);

            // Calculate offsets relative to floor reference position
            const plane = detectedPlane;
            const basePosition = (plane.referencePosition || plane.centroid).clone();

            rugParams.offsetX = savedPosition.x - basePosition.x;
            rugParams.offsetY = savedPosition.y - basePosition.y;
            rugParams.offsetZ = savedPosition.z - basePosition.z;
            rugParams.rotation = savedParams.rotation;
            rugParams.scale = savedParams.scale;

            // Apply rotation and orientation
            const up = new THREE.Vector3(0, 0, 1);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(up, plane.normal);
            rug.quaternion.copy(quaternion);

            const rotationQuat = new THREE.Quaternion().setFromAxisAngle(plane.normal, rugParams.rotation * Math.PI / 180);
            rug.quaternion.premultiply(rotationQuat);

            rug.scale.set(rugParams.scale, rugParams.scale, rugParams.scale);
            rug.visible = rugParams.visible;

            console.log('Rug replaced at saved position:', savedPosition);
        } else {
            // Reset offsets since we're calculating a fresh position
            rugParams.offsetX = 0;
            rugParams.offsetY = 0;
            rugParams.offsetZ = 0;
            rugParams.rotation = 0; // Start at 0 rotation for new rug

            placeRugOnFloor();

            // Save current camera position
            setLastCameraPosition(currentCameraPos);
            console.log('Rug placed at new position based on camera. Camera position saved:', currentCameraPos);
        }

        setupRugGUI();
        updateGizmo();
        status.textContent = 'Rug placed! Use controls on the right to adjust. Hover over rug to see gizmo. Hover over the corners for resizing.';
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
    }
}

export function onRugMouseDown(event) {
    if (!rug || !rug.visible) return false;

    // Check if clicking on corner handle (for resizing)
    const cornerIndex = findCornerIntersection(event);
    if (cornerIndex !== null) {
        setIsResizing(true);
        setIsDragging(false);
        setIsRotating(false);
        setActiveCorner(cornerIndex);
        setInitialScale(rugParams.scale);
        setInitialRugCenter(rug.position.clone());

        // Get opposite corner index (0<->2, 1<->3)
        const oppositeIndex = (cornerIndex + 2) % 4;

        // Get corner world positions
        const oppCornerWorld = new THREE.Vector3();
        cornerHandles[oppositeIndex].getWorldPosition(oppCornerWorld);
        setOppositeCornerWorld(oppCornerWorld);

        const dragCornerWorld = new THREE.Vector3();
        cornerHandles[cornerIndex].getWorldPosition(dragCornerWorld);
        setDraggedCornerWorld(dragCornerWorld);

        // Store initial distance between corners
        setInitialDistance(oppCornerWorld.distanceTo(dragCornerWorld));

        if (viewer.controls) viewer.controls.enabled = false;
        if (window.pauseCameraReset) window.pauseCameraReset(true);
        viewer.renderer.domElement.style.cursor = 'nwse-resize';
        event.preventDefault();
        return true;
    }

    // Check if clicking on gizmo (for rotation)
    if (findGizmoIntersection(event)) {
        setIsRotating(true);
        setIsDragging(false);
        setIsResizing(false);
        setPreviousMouse({ x: event.clientX, y: event.clientY });
        if (viewer.controls) viewer.controls.enabled = false;
        if (window.pauseCameraReset) window.pauseCameraReset(true);
        viewer.renderer.domElement.style.cursor = 'grabbing';
        event.preventDefault();
        return true;
    }

    // Check if clicking on rug (for dragging)
    const intersect = raycastMouseOnRug(event);
    if (intersect) {
        setIsDragging(true);
        setIsRotating(false);
        setIsResizing(false);

        // Calculate offset using floor plane intersection, not rug intersection
        // This ensures consistent behavior on tilted floors
        const rect = viewer.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewer.camera);

        // Raycast to the floor plane at the rug's position
        const floorPlane = new THREE.Plane();
        floorPlane.setFromNormalAndCoplanarPoint(detectedPlane.normal, rug.position);

        const floorPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(floorPlane, floorPoint);

        if (floorPoint) {
            // Calculate offset from floor intersection to rug center
            offset.copy(floorPoint).sub(rug.position);
        } else {
            // Fallback to old method if raycast fails
            offset.copy(intersect.point).sub(rug.position);
        }

        if (viewer.controls) viewer.controls.enabled = false;
        if (window.pauseCameraReset) window.pauseCameraReset(true);
        viewer.renderer.domElement.style.cursor = 'grabbing';
        event.preventDefault();
        return true;
    }

    return false;
}

export function onRugMouseMove(event) {
    if (!rug || !rug.visible) return false;

    if (isResizing) {
        // Raycast to floor plane to find mouse position in 3D space
        const rect = viewer.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewer.camera);

        // Create a plane at the rug's current position with the floor normal
        const floorPlane = new THREE.Plane();
        floorPlane.setFromNormalAndCoplanarPoint(detectedPlane.normal, rug.position);

        // Find intersection point on the floor plane
        const mouseWorldPos = new THREE.Vector3();
        raycaster.ray.intersectPlane(floorPlane, mouseWorldPos);

        if (mouseWorldPos) {
            // Calculate new distance from opposite corner to mouse
            const currentDistance = oppositeCornerWorld.distanceTo(mouseWorldPos);

            // Calculate scale ratio
            const scaleRatio = currentDistance / initialDistance;
            const newScale = Math.max(0.1, Math.min(10, initialScale * scaleRatio));
            rugParams.scale = newScale;

            // Calculate new rug center position
            // The center should be midway between the opposite corner and the mouse position
            const newCenter = new THREE.Vector3().addVectors(oppositeCornerWorld, mouseWorldPos).multiplyScalar(0.5);

            // Preserve the original Y position - don't let resizing change height
            newCenter.y = rug.position.y;

            // Update offset parameters to reflect the new position
            const initialPos = (detectedPlane.referencePosition || detectedPlane.centroid).clone();

            rugParams.offsetX = newCenter.x - initialPos.x;
            // Don't update offsetY - keep rug at same height when resizing
            rugParams.offsetZ = newCenter.z - initialPos.z;

            // Update position directly, then apply rotation and scale without recalculating position
            rug.position.copy(newCenter);
            updateRug(true);

            if (gui) {
                gui.controllersRecursive().forEach(controller => controller.updateDisplay());
            }
        }

        event.preventDefault();
        return true;
    } else if (isRotating) {
        const deltaX = previousMouse.x - event.clientX;
        rugParams.rotation += deltaX;
        if (rugParams.rotation < 0) rugParams.rotation += 360;
        if (rugParams.rotation >= 360) rugParams.rotation -= 360;

        updateRug(true); // Skip position recalculation, only update rotation

        if (gui) {
            gui.controllersRecursive().forEach(controller => controller.updateDisplay());
        }

        setPreviousMouse({ x: event.clientX, y: event.clientY });
        event.preventDefault();
        return true;
    } else if (isDragging) {
        // Raycast onto the floor plane instead of the rug for accurate dragging
        const rect = viewer.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewer.camera);

        // Create a plane at the rug's current position with the floor normal
        const floorPlane = new THREE.Plane();
        floorPlane.setFromNormalAndCoplanarPoint(detectedPlane.normal, rug.position);

        // Find intersection point on the floor plane
        const mouseWorldPos = new THREE.Vector3();
        const intersected = raycaster.ray.intersectPlane(floorPlane, mouseWorldPos);

        if (intersected && mouseWorldPos) {
            const newPos = mouseWorldPos.clone().sub(offset);

            // Let the plane intersection handle positioning - it automatically keeps the rug
            // on the floor whether it's horizontal, vertical, or tilted
            // No need to fix individual coordinates - the plane constraint handles everything

            rug.position.copy(newPos);

            // Update the offset params to match
            const initialPos = (detectedPlane.referencePosition || detectedPlane.centroid).clone();

            rugParams.offsetX = newPos.x - initialPos.x;
            rugParams.offsetY = newPos.y - initialPos.y;
            rugParams.offsetZ = newPos.z - initialPos.z;

            if (gui) {
                gui.controllersRecursive().forEach(controller => controller.updateDisplay());
            }

            updateGizmo();
            event.preventDefault();
        }
        return true;
    } else {
        // Check wall decor hover first
        if (wallDecor && wallDecor.visible) {
            const wallIntersect = raycastMouseOnWallDecor(event);
            if (wallIntersect) {
                viewer.renderer.domElement.style.cursor = 'move';
                return false; // Let wallDecor handler deal with it
            }
        }

        // Then check rug hover
        const cornerIndex = findCornerIntersection(event);
        if (cornerIndex !== null) {
            updateGizmo(true);
            viewer.renderer.domElement.style.cursor = 'nwse-resize';
            return true;
        } else if (findGizmoIntersection(event)) {
            updateGizmo(true);
            viewer.renderer.domElement.style.cursor = 'grab';
            return true;
        } else {
            const intersect = raycastMouseOnRug(event);
            if (intersect) {
                updateGizmo(true);
                viewer.renderer.domElement.style.cursor = 'move';
                return true;
            } else {
                updateGizmo(false);
                viewer.renderer.domElement.style.cursor = 'default';
                return false;
            }
        }
    }
}

export function onRugMouseUp(event) {
    if (isDragging || isRotating || isResizing) {
        setIsDragging(false);
        setIsRotating(false);
        setIsResizing(false);
        setActiveCorner(null);
        setOppositeCornerWorld(null);
        setDraggedCornerWorld(null);
        setInitialRugCenter(null);
        if (viewer.controls) viewer.controls.enabled = true; // Re-enable controls after interaction
        if (window.pauseCameraReset) window.pauseCameraReset(false);
        viewer.renderer.domElement.style.cursor = 'default';
        event.preventDefault();
        return true;
    }
    return false;
}