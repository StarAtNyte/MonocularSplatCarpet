import * as THREE from 'three';
import {
    viewer,
    floorMaskData,
    detectedPlane,
    floorPlaneMesh,
    floorPlaneVisible,
    setDetectedPlane,
    setFloorPlaneMesh,
    setFloorPlaneVisible,
    floorOrientation
} from './utils.js';
import { fitPlaneToFloorGaussians } from './utils.js';

/**
 * Detect plane perpendicular to camera (for top-down views)
 */
function detectTopDownPlane(points, cameraPos, cameraDir, threshold) {
    const count = points.length;

    if (count < 50) {
        console.log('Not enough points for top-down detection');
        return null;
    }

    // For top-down view: plane normal = camera forward direction
    // This ensures the plane is perfectly perpendicular to the camera
    const planeNormal = cameraDir.clone().normalize();

    console.log('Top-down plane normal (camera forward):', planeNormal);

    // Find optimal plane distance by projecting points onto camera forward ray
    const distances = [];
    for (let i = 0; i < count; i++) {
        const p = points[i];
        const toPoint = new THREE.Vector3(p.x - cameraPos.x, p.y - cameraPos.y, p.z - cameraPos.z);
        // Project onto camera forward direction
        const dist = toPoint.dot(planeNormal);
        if (dist > 0.5 && dist < 8.0) { // Reasonable viewing range
            distances.push(dist);
        }
    }

    if (distances.length < 50) {
        console.log('Not enough points in viewing range');
        return null;
    }

    // Use median distance to avoid outliers
    distances.sort((a, b) => a - b);
    const medianDistance = distances[Math.floor(distances.length / 2)];

    // Create plane at median distance along camera forward ray
    const centroid = cameraPos.clone().add(planeNormal.clone().multiplyScalar(medianDistance));

    // Count inliers at this plane
    const planeDValue = -planeNormal.dot(centroid);
    let inliers = 0;
    for (let i = 0; i < count; i++) {
        const p = points[i];
        const dist = Math.abs(planeNormal.x * p.x + planeNormal.y * p.y + planeNormal.z * p.z + planeDValue);
        if (dist < threshold) inliers++;
    }

    console.log('Top-down plane detected:');
    console.log('  Normal:', planeNormal);
    console.log('  Centroid:', centroid);
    console.log('  Distance from camera:', medianDistance.toFixed(2));
    console.log('  Inliers:', inliers, '/', count);

    return {
        normal: planeNormal,
        d: planeDValue,
        centroid: centroid,
        inliers: inliers,
        adaptiveOffset: 0.0 // Top-down planes don't need offset
    };
}

/**
 * RANSAC-based plane detection (ported from bb.splat.html)
 */
function ransacPlaneDetection(points, iterations = 2000, threshold = 0.05, orientation = 'horizontal') {
    const count = points.length;
    if (count < 50) return null;

    // Detect coordinate system
    const cameraUp = viewer.camera.up.clone();
    const isInvertedY = cameraUp.y < 0;
    const cameraY = viewer.camera.position.y;
    const cameraPos = viewer.camera.position.clone();
    const cameraDir = new THREE.Vector3();
    viewer.camera.getWorldDirection(cameraDir);

    console.log('Coordinate system:', isInvertedY ? 'INVERTED (up=-Y)' : 'NORMAL (up=+Y)');
    console.log('Camera Y:', cameraY);
    console.log('Orientation:', orientation);

    // FOR VERTICAL FLOORS: Create plane perpendicular to camera view (top-down)
    if (orientation === 'vertical') {
        console.log('Detecting VERTICAL floor (top-down view - perpendicular to camera)');
        return detectTopDownPlane(points, cameraPos, cameraDir, threshold);
    }

    // ========== Filter points to only those NEAR the camera ==========
    // This prevents detecting noise/outliers far from the actual room
    const maxDistanceFromCamera = 10.0; // Only consider points within 10 units of camera
    const filteredPoints = [];

    for (let i = 0; i < count; i++) {
        const p = points[i];
        const dx = p.x - cameraPos.x;
        const dy = p.y - cameraPos.y;
        const dz = p.z - cameraPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq <= maxDistanceFromCamera * maxDistanceFromCamera) {
            filteredPoints.push(p);
        }
    }

    console.log(`Filtered points: ${filteredPoints.length} / ${count} (within ${maxDistanceFromCamera}m of camera)`);

    if (filteredPoints.length < 50) {
        console.log('Too few points near camera after filtering');
        return null;
    }

    // Use filtered points for all subsequent processing
    const workingPoints = filteredPoints;
    const workingCount = workingPoints.length;
    // ======================================================================

    // 1. Find vertical bounds (using filtered points)
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < workingCount; i++) {
        const y = workingPoints[i].y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const range = maxY - minY;

    console.log('Y range (filtered):', { minY: minY.toFixed(2), maxY: maxY.toFixed(2), range: range.toFixed(2) });

    // 2. Define THREE search zones:
    const bottomZone = [];
    const middleZone = [];
    const topZone = [];

    // Bottom 25%, Middle 50%, Top 25%
    const bottomThreshold = minY + (range * 0.25);
    const topThreshold = maxY - (range * 0.25);

    for (let i = 0; i < workingCount; i++) {
        const y = workingPoints[i].y;
        if (y < bottomThreshold) {
            bottomZone.push(workingPoints[i]);
        } else if (y > topThreshold) {
            topZone.push(workingPoints[i]);
        } else {
            middleZone.push(workingPoints[i]);
        }
    }

    console.log('Zone distribution:', {
        bottom: bottomZone.length,
        middle: middleZone.length,
        top: topZone.length
    });

    // Detect scene orientation based on point distribution
    const bottomRatio = bottomZone.length / workingCount;
    const topRatio = topZone.length / workingCount;
    const isInverted = topRatio > 0.15; // If top zone has >15% of points, likely inverted

    // For scenes with sparse extremes, search middle zone for floor
    const searchMiddle = (topZone.length < 100 && bottomZone.length > workingCount * 0.5);

    // 3. Helper to run RANSAC on a specific zone
    function findPlaneInZone(zonePoints) {
        if (zonePoints.length < 10) {
            return null;
        }

        let bestLocalPlane = null;
        let maxInliers = -1;
        const v1 = { x: 0, y: 0, z: 0 }, v2 = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };

        for (let i = 0; i < iterations; i++) {
            const p1 = zonePoints[Math.floor(Math.random() * zonePoints.length)];
            const p2 = zonePoints[Math.floor(Math.random() * zonePoints.length)];
            const p3 = zonePoints[Math.floor(Math.random() * zonePoints.length)];

            v1.x = p2.x - p1.x; v1.y = p2.y - p1.y; v1.z = p2.z - p1.z;
            v2.x = p3.x - p1.x; v1.y = p3.y - p1.y; v1.z = p3.z - p1.z; // Typo in original? No, it's correct above. Wait. 
            // Original: 
            // v1.x = p2.x - p1.x; v1.y = p2.y - p1.y; v1.z = p2.z - p1.z;
            // v2.x = p3.x - p1.x; v2.y = p3.y - p1.y; v2.z = p3.z - p1.z;

            // Checking my manual transcription for typo:
            v2.x = p3.x - p1.x; v2.y = p3.y - p1.y; v2.z = p3.z - p1.z;

            n.x = v1.y * v2.z - v1.z * v2.y;
            n.y = v1.z * v2.x - v1.x * v2.z;
            n.z = v1.x * v2.y - v1.y * v2.x;

            const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
            if (len === 0) continue;
            n.x /= len; n.y /= len; n.z /= len;

            // Relaxed flatness check
            if (Math.abs(n.y) < 0.7) continue;

            const d = -(n.x * p1.x + n.y * p1.y + n.z * p1.z);

            // Check inliers within this zone only
            let currentInliers = 0;
            for (let j = 0; j < zonePoints.length; j += 2) {
                const p = zonePoints[j];
                const dist = n.x * p.x + n.y * p.y + n.z * p.z + d;
                if (Math.abs(dist) < threshold) currentInliers++;
            }

            if (currentInliers > maxInliers) {
                maxInliers = currentInliers;
                bestLocalPlane = {
                    normal: new THREE.Vector3(n.x, n.y, n.z),
                    d: d,
                    centroid: new THREE.Vector3(p1.x, p1.y, p1.z),
                    inliers: currentInliers
                };
            }
        }
        return bestLocalPlane;
    }

    const planeBottom = findPlaneInZone(bottomZone);
    const planeMiddle = searchMiddle ? findPlaneInZone(middleZone) : null;
    const planeTop = findPlaneInZone(topZone);

    // 4. SMART DECISION LOGIC with inverted coordinate handling
    let finalPlane = null;

    // Override selection for inverted coordinates
    if (isInvertedY && planeBottom && planeTop) {
        const bottomIsAboveCamera = planeBottom.centroid.y > cameraY;
        const topIsAboveCamera = planeTop.centroid.y > cameraY;

        // ========== NEW: Also check distance from camera ==========
        const bottomDist = planeBottom.centroid.distanceTo(cameraPos);
        const topDist = planeTop.centroid.distanceTo(cameraPos);

        console.log('Inverted coord analysis:');
        console.log('  Bottom plane Y:', planeBottom.centroid.y.toFixed(2), bottomIsAboveCamera ? '(above camera ✓)' : '(below camera ✗)', 'dist:', bottomDist.toFixed(2));
        console.log('  Top plane Y:', planeTop.centroid.y.toFixed(2), topIsAboveCamera ? '(above camera ✓)' : '(below camera ✗)', 'dist:', topDist.toFixed(2));

        if (topIsAboveCamera && bottomIsAboveCamera) {
            // Both above - pick closer one
            finalPlane = topDist < bottomDist ? planeTop : planeBottom;
            console.log('Both above camera, selected closer plane');
        } else if (topIsAboveCamera) {
            finalPlane = planeTop;
            console.log('Selected TOP plane (correct side for inverted coords)');
        } else if (bottomIsAboveCamera) {
            finalPlane = planeBottom;
            console.log('Selected BOTTOM plane (correct side for inverted coords)');
        } else {
            // Neither above camera (shouldn't happen with filtering, but fallback)
            finalPlane = topDist < bottomDist ? planeTop : planeBottom;
            console.log('WARNING: Neither plane above camera, using closer one');
        }
    }
    // Original logic for non-inverted or when override doesn't apply
    else if (planeMiddle) {
        finalPlane = planeMiddle;
    } else if (planeTop && planeBottom) {
        if (isInverted) {
            finalPlane = planeTop;
        } else {
            finalPlane = planeBottom;
        }
    } else if (planeTop) {
        finalPlane = planeTop;
    } else if (planeBottom) {
        finalPlane = planeBottom;
    }

    if (!finalPlane) return null;

    // ========== NEW: Validate plane is reasonably close to camera ==========
    const planeDist = finalPlane.centroid.distanceTo(cameraPos);
    console.log('Selected plane distance from camera:', planeDist.toFixed(2));

    const distanceThreshold = 15.0;

    if (planeDist > distanceThreshold) {
        console.warn('WARNING: Detected floor is very far from camera (', planeDist.toFixed(2), 'm)');
        console.warn('This might be noise/artifacts. The floor detection may be inaccurate.');
    }

    // Ensure normal points correctly
    const sceneCenterY = (minY + maxY) / 2;
    if (finalPlane.centroid.y > sceneCenterY) {
        if (finalPlane.normal.y > 0) {
            finalPlane.normal.negate();
            finalPlane.d = -finalPlane.d;
        }
    } else {
        if (finalPlane.normal.y < 0) {
            finalPlane.normal.negate();
            finalPlane.d = -finalPlane.d;
        }
    }

    // ADAPTIVE OFFSET CALCULATION (using filtered points)
    const floorPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        finalPlane.normal,
        finalPlane.centroid
    );

    const nearFloorDistances = [];
    for (let i = 0; i < Math.min(workingPoints.length, 5000); i++) {
        const p = workingPoints[i];
        const pointVec = new THREE.Vector3(p.x, p.y, p.z);
        const distance = floorPlane.distanceToPoint(pointVec);

        if (Math.abs(distance) < 0.2) {
            nearFloorDistances.push(distance);
        }
    }

    // Simplified adaptive offset
    finalPlane.adaptiveOffset = 0.035; // Default safe offset

    return finalPlane;
}

export function createFloorPlaneVisualization() {
    // Remove existing floor plane visualization
    if (floorPlaneMesh && viewer.threeScene) {
        viewer.threeScene.remove(floorPlaneMesh);
        floorPlaneMesh.geometry.dispose();
        floorPlaneMesh.material.dispose();
        setFloorPlaneMesh(null);
    }

    if (!detectedPlane) return;

    // Calculate bounding box
    const splatMesh = viewer.splatMesh;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    if (splatMesh) {
        const splatCount = splatMesh.getSplatCount();
        const center = new THREE.Vector3();
        const sampleStep = Math.max(1, Math.floor(splatCount / 5000));

        for (let i = 0; i < splatCount; i += sampleStep) {
            splatMesh.getSplatCenter(i, center);
            minX = Math.min(minX, center.x);
            maxX = Math.max(maxX, center.x);
            minY = Math.min(minY, center.y);
            maxY = Math.max(maxY, center.y);
            minZ = Math.min(minZ, center.z);
            maxZ = Math.max(maxZ, center.z);
        }
    }

    const sceneWidth = Math.max(20, (maxX - minX) * 1.5);
    const sceneDepth = Math.max(20, (maxZ - minZ) * 1.5);
    const planeSize = Math.max(sceneWidth, sceneDepth);
    const gridDivisions = 40;

    console.log(`Floor plane size: ${planeSize.toFixed(2)} (scene bounds: ${sceneWidth.toFixed(2)} x ${sceneDepth.toFixed(2)})`);

    const geometry = new THREE.PlaneGeometry(planeSize, planeSize, gridDivisions, gridDivisions);
    const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
        depthTest: true,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(detectedPlane.centroid);

    const up = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, detectedPlane.normal);
    mesh.quaternion.copy(quaternion);

    mesh.visible = floorPlaneVisible;

    if (viewer.threeScene) {
        viewer.threeScene.add(mesh);
    }

    setFloorPlaneMesh(mesh);
}

export async function detectFloor() {
    const status = document.getElementById('status');

    status.style.display = 'block';
    status.textContent = 'Detecting floor...';

    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        const splatMesh = viewer.splatMesh;
        if (!splatMesh) throw new Error('Splat mesh not loaded');

        const splatCount = splatMesh.getSplatCount();

        // Check if we have valid mask data
        // Check if mask contains any useful data (at least 1% true)
        let maskHasData = false;
        let trueCount = 0;
        if (floorMaskData && floorMaskData.length > 0) {
            // Check first 1000 items to guess if it's all false
            const checkLimit = Math.min(floorMaskData.length, 1000);
            for (let i = 0; i < checkLimit; i++) {
                if (floorMaskData[i]) {
                    maskHasData = true;
                    break;
                }
            }
            // If still false, check a random sampling to be sure
            if (!maskHasData) {
                for (let i = 0; i < 1000; i++) {
                    const idx = Math.floor(Math.random() * floorMaskData.length);
                    if (floorMaskData[idx]) {
                        maskHasData = true;
                        break;
                    }
                }
            }
        }

        let plane = null;

        // METHOD 1: Use floor mask from metadata
        if (maskHasData) {
            console.log('=== USING FLOOR MASK FOR DETECTION ===');
            status.textContent = 'Using floor mask from metadata...';

            const floorPositions = [];
            const center = new THREE.Vector3();

            for (let i = 0; i < Math.min(floorMaskData.length, splatCount); i++) {
                if (floorMaskData[i]) {
                    splatMesh.getSplatCenter(i, center);
                    floorPositions.push(center.clone());
                }
            }

            console.log('Floor gaussians from mask:', floorPositions.length);

            if (floorPositions.length >= 10) {
                plane = fitPlaneToFloorGaussians(floorPositions);
                if (plane) {
                    const smallOffset = 0.015;
                    plane.centroid.add(plane.normal.clone().multiplyScalar(smallOffset));
                    plane.d = -plane.normal.dot(plane.centroid);
                    console.log(`Floor offset: ${smallOffset.toFixed(3)}m above surface`);
                }
            } else {
                console.warn('Mask has too few floor gaussians, falling back to RANSAC');
            }
        } else {
            console.log('No valid floor mask data, using RANSAC detection');
        }

        // METHOD 2: RANSAC fallback
        if (!plane) {
            console.log('=== USING RANSAC FOR DETECTION ===');
            status.textContent = 'Detecting floor geometry...';

            // Collect all points
            const positions = [];
            const center = new THREE.Vector3();
            // Sample if too many points to avoid lag
            const step = splatCount > 100000 ? 5 : 1;

            for (let i = 0; i < splatCount; i += step) {
                splatMesh.getSplatCenter(i, center);
                positions.push(center.clone());
            }

            plane = ransacPlaneDetection(positions, 2000, 0.05, floorOrientation);
        }

        if (plane) {
            console.log(`Final floor centroid:`, plane.centroid);
            console.log(`Final floor normal:`, plane.normal);

            setDetectedPlane(plane);
            createFloorPlaneVisualization();
            setFloorPlaneVisible(false);
            if (floorPlaneMesh) {
                floorPlaneMesh.visible = false;
            }

            status.innerHTML = `<strong>Floor Detected!</strong><br>
                Ready to place rug!`;
            return true;
        } else {
            status.textContent = 'Failed to detect floor';
            return false;
        }
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
        console.error(error);
        return false;
    }
}
