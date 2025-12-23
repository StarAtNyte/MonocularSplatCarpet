import * as THREE from 'three';
import {
    viewer,
    wallMaskData,
    detectedWallPlane,
    wallGaussianPositions,
    wallGaussianBounds,
    wallClusters,
    activeWall,
    setDetectedWallPlane,
    setWallGaussianPositions,
    setWallGaussianBounds,
    setWallClusters,
    setActiveWall
} from './utils.js';
import { fitPlaneToWallGaussians, fitPlaneToFloorGaussians } from './utils.js';

/**
 * Collect wall gaussians - simple and fast!
 */
export function collectWallGaussians() {
    if (!wallMaskData || !viewer.splatMesh) {
        console.warn('No wall mask data or splat mesh available');
        return false;
    }

    const splatMesh = viewer.splatMesh;
    const splatCount = splatMesh.getSplatCount();
    const positions = [];
    const center = new THREE.Vector3();

    console.log('=== COLLECTING WALL GAUSSIANS ===');

    for (let i = 0; i < Math.min(wallMaskData.length, splatCount); i++) {
        if (wallMaskData[i]) {
            splatMesh.getSplatCenter(i, center);
            positions.push(center.clone());
        }
    }

    console.log(`✅ Collected ${positions.length} wall gaussians`);

    if (positions.length < 10) {
        console.warn('Not enough wall gaussians');
        return false;
    }

    // Calculate bounds
    const bounds = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    };

    for (const pos of positions) {
        bounds.min.min(pos);
        bounds.max.max(pos);
    }

    setWallGaussianPositions(positions);
    setWallGaussianBounds(bounds);

    // Clear cluster cache
    setWallClusters([]);
    setActiveWall(null);

    return true;
}

/**
 * Get surface gaussians (outer layer closest to camera)
 */
export function getSurfaceGaussians(cameraPos) {
    if (wallGaussianPositions.length === 0) {
        console.warn('No wall gaussians available');
        return [];
    }

    // Find closest gaussian
    let minDist = Infinity;
    for (const pos of wallGaussianPositions) {
        const dist = pos.distanceTo(cameraPos);
        if (dist < minDist) minDist = dist;
    }

    // Surface = all gaussians within threshold
    const threshold = 0.3;
    const surfaceGaussians = [];

    for (const pos of wallGaussianPositions) {
        const dist = pos.distanceTo(cameraPos);
        if (dist <= minDist + threshold) {
            surfaceGaussians.push(pos);
        }
    }

    console.log(`Surface filter: ${surfaceGaussians.length} / ${wallGaussianPositions.length} gaussians (threshold: ${threshold}m)`);

    return surfaceGaussians;
}

/**
 * Find which wall cluster the camera is looking at
 */
export function findCameraFacingWall(wallClusters, cameraPos, cameraDirection) {
    if (wallClusters.length === 0) return null;
    if (wallClusters.length === 1) return wallClusters[0];

    let bestWall = null;
    let bestScore = -Infinity;

    for (const wall of wallClusters) {
        const alignment = wall.normal.dot(cameraDirection.clone().negate());

        const distToWall = Math.abs(new THREE.Plane()
            .setFromNormalAndCoplanarPoint(wall.normal, wall.centroid)
            .distanceToPoint(cameraPos));

        const score = alignment - (distToWall * 0.1);

        if (score > bestScore) {
            bestScore = score;
            bestWall = wall;
        }
    }

    if (bestWall) {
        console.log(`📍 Camera facing Wall ${bestWall.id}: alignment score ${bestScore.toFixed(2)}`);
    }

    return bestWall;
}

/**
 * Get wall normal at a position
 */
export function getWallNormalAtPosition(position, cameraPos, numSamples = 100) {
    if (wallGaussianPositions.length < numSamples) {
        numSamples = Math.max(30, Math.floor(wallGaussianPositions.length / 10));
    }

    const distances = wallGaussianPositions.map((pos, idx) => ({
        pos: pos,
        dist: position.distanceToSquared(pos),
        idx: idx
    }));

    distances.sort((a, b) => a.dist - b.dist);
    const nearest = distances.slice(0, numSamples).map(d => d.pos);

    const plane = fitPlaneToWallGaussians(nearest, cameraPos);

    if (!plane) {
        console.warn('Could not fit plane to nearest gaussians');
        return null;
    }

    const camToWall = new THREE.Vector3().subVectors(plane.centroid, cameraPos);
    if (plane.normal.dot(camToWall) > 0) {
        plane.normal.negate();
    }

    return plane;
}

/**
 * Cluster wall gaussians by orientation
 */
export function clusterWallsByOrientation(positions, cameraPos) {
    if (positions.length < 50) return [];

    console.log(`🔷 Clustering ${positions.length} wall gaussians by orientation...`);

    // Use fewer samples for performance
    const targetSamples = Math.min(100, Math.max(20, Math.floor(positions.length / 2000)));
    const step = Math.floor(positions.length / targetSamples);
    const samples = [];

    for (let i = 0; i < positions.length; i += step) {
        samples.push(positions[i]);
        if (samples.length >= targetSamples) break;
    }

    console.log(`📊 Using ${samples.length} sample points for clustering`);

    // Fit local planes
    const localPlanes = [];
    for (const sample of samples) {
        const nearby = positions.filter(p => p.distanceTo(sample) < 1.0);
        if (nearby.length < 20) continue;

        const plane = fitPlaneToWallGaussians(nearby, cameraPos);
        if (plane) {
            localPlanes.push(plane);
        }
    }

    if (localPlanes.length === 0) return [];

    console.log(`📐 Found ${localPlanes.length} local plane samples`);

    // Cluster by normal similarity
    const normalThreshold = 0.3;
    const clusteredPlanes = [];

    for (const plane of localPlanes) {
        let merged = false;

        for (const cluster of clusteredPlanes) {
            const similarity = Math.abs(plane.normal.dot(cluster.normal));
            if (similarity > normalThreshold) {
                merged = true;
                break;
            }
        }

        if (!merged) {
            clusteredPlanes.push({
                normal: plane.normal.clone(),
                centroid: plane.centroid.clone(),
                gaussians: []
            });
        }
    }

    // Assign gaussians to planes
    const threePlanes = clusteredPlanes.map(plane =>
        new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.centroid)
    );

    console.log(`🔍 Assigning ${positions.length} gaussians to ${clusteredPlanes.length} clusters...`);

    for (const pos of positions) {
        let bestPlane = null;
        let bestDist = Infinity;

        for (let i = 0; i < threePlanes.length; i++) {
            const dist = Math.abs(threePlanes[i].distanceToPoint(pos));

            if (dist < bestDist) {
                bestDist = dist;
                bestPlane = clusteredPlanes[i];
            }
        }

        if (bestPlane && bestDist < 1.0) {
            bestPlane.gaussians.push(pos);
        }
    }

    // Refit planes
    const finalPlanes = [];
    console.log(`🧱 Identified ${clusteredPlanes.length} distinct wall orientations`);

    for (let i = 0; i < clusteredPlanes.length; i++) {
        const cluster = clusteredPlanes[i];
        if (cluster.gaussians.length < 50) {
            console.log(`  Wall ${i}: Skipped (only ${cluster.gaussians.length} gaussians)`);
            continue;
        }

        const plane = fitPlaneToWallGaussians(cluster.gaussians, cameraPos);
        if (plane) {
            finalPlanes.push({
                id: i,
                normal: plane.normal,
                centroid: plane.centroid,
                gaussians: cluster.gaussians,
                plane: plane
            });
            console.log(`  ✓ Wall ${i}: ${cluster.gaussians.length.toLocaleString()} gaussians, normal: [${plane.normal.x.toFixed(2)}, ${plane.normal.y.toFixed(2)}, ${plane.normal.z.toFixed(2)}]`);
        }
    }

    console.log(`✅ Final result: ${finalPlanes.length} wall clusters created`);
    return finalPlanes;
}

/**
 * Cluster walls from gaussians using spatial distribution
 */
export function clusterWallsFromGaussians(wallMaskData, splatMesh) {
    const splatCount = splatMesh.getSplatCount();
    const wallPositions = [];
    const center = new THREE.Vector3();

    console.log('=== CLUSTERING WALLS ===');
    const startTime = performance.now();

    for (let i = 0; i < Math.min(wallMaskData.length, splatCount); i++) {
        if (wallMaskData[i]) {
            splatMesh.getSplatCenter(i, center);
            wallPositions.push(center.clone());
        }
    }

    console.log('Total wall Gaussians:', wallPositions.length);

    if (wallPositions.length < 10) {
        console.warn('Not enough wall Gaussians to cluster');
        return [];
    }

    // Grid-based clustering
    const voxelSize = 0.3;
    const voxelMap = new Map();

    for (const pos of wallPositions) {
        const vx = Math.floor(pos.x / voxelSize);
        const vy = Math.floor(pos.y / voxelSize);
        const vz = Math.floor(pos.z / voxelSize);
        const key = `${vx},${vy},${vz}`;

        if (!voxelMap.has(key)) {
            voxelMap.set(key, []);
        }
        voxelMap.get(key).push(pos);
    }

    console.log('Voxelized into', voxelMap.size, 'voxels');

    // Flood fill
    const visited = new Set();
    const clusters = [];

    for (const [voxelKey, positions] of voxelMap.entries()) {
        if (visited.has(voxelKey)) continue;

        const cluster = [];
        const queue = [voxelKey];
        visited.add(voxelKey);

        while (queue.length > 0) {
            const currentKey = queue.shift();
            cluster.push(...voxelMap.get(currentKey));

            const [vx, vy, vz] = currentKey.split(',').map(Number);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dy === 0 && dz === 0) continue;

                        const neighborKey = `${vx + dx},${vy + dy},${vz + dz}`;
                        if (voxelMap.has(neighborKey) && !visited.has(neighborKey)) {
                            visited.add(neighborKey);
                            queue.push(neighborKey);
                        }
                    }
                }
            }
        }

        if (cluster.length >= 30) {
            clusters.push(cluster);
        }
    }

    console.log('Found', clusters.length, 'spatial clusters');

    // Fit planes and merge
    const clustersWithPlanes = [];
    for (const cluster of clusters) {
        const plane = fitPlaneToFloorGaussians(cluster);
        if (plane) {
            clustersWithPlanes.push({ positions: cluster, plane: plane });
        }
    }

    // Merge by normal
    const mergedClusters = [];
    const normalThreshold = 0.9;

    for (const cluster of clustersWithPlanes) {
        let merged = false;

        for (const existing of mergedClusters) {
            const normalAlignment = Math.abs(cluster.plane.normal.dot(existing.plane.normal));

            if (normalAlignment > normalThreshold) {
                existing.positions.push(...cluster.positions);
                merged = true;
                break;
            }
        }

        if (!merged) {
            mergedClusters.push({
                positions: [...cluster.positions],
                plane: cluster.plane
            });
        }
    }

    console.log('After merging by orientation:', mergedClusters.length, 'wall groups');

    // Filter vertical walls
    const walls = [];
    const colors = [
        '#ff0000', '#00ff00', '#0000ff', '#ffff00',
        '#ff00ff', '#00ffff', '#ff8800', '#8800ff'
    ];

    let wallIndex = 0;
    for (let i = 0; i < mergedClusters.length; i++) {
        const positions = mergedClusters[i].positions;

        const plane = fitPlaneToFloorGaussians(positions);
        if (!plane) continue;

        const absY = Math.abs(plane.normal.y);

        if (absY > 0.5) {
            console.log(`❌ Rejected cluster ${i}: ${positions.length} gaussians - horizontal surface (|normal.y|=${absY.toFixed(2)} > 0.5)`);
            continue;
        }

        const bounds = {
            min: new THREE.Vector3(Infinity, Infinity, Infinity),
            max: new THREE.Vector3(-Infinity, -Infinity, -Infinity)
        };

        for (const pos of positions) {
            bounds.min.min(pos);
            bounds.max.max(pos);
        }

        walls.push({
            id: wallIndex,
            plane: plane,
            positions: positions,
            color: colors[wallIndex % colors.length],
            bounds: bounds,
            gaussianCount: positions.length
        });

        console.log(`✅ Wall ${wallIndex}: ${positions.length} gaussians, normal: [${plane.normal.x.toFixed(2)}, ${plane.normal.y.toFixed(2)}, ${plane.normal.z.toFixed(2)}] (|Y|=${absY.toFixed(2)})`);
        wallIndex++;
    }

    const elapsed = performance.now() - startTime;
    console.log(`Clustering took ${elapsed.toFixed(0)}ms`);

    return walls;
}

export async function detectWall() {
    const status = document.getElementById('status');

    status.style.display = 'block';
    status.textContent = 'Detecting wall...';

    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        const splatMesh = viewer.splatMesh;
        if (!splatMesh) throw new Error('Splat mesh not loaded');

        // Use wall mask from metadata
        if (!wallMaskData || !Array.isArray(wallMaskData)) {
            throw new Error('No wall mask data available. Please load a room with metadata.');
        }

        console.log('=== USING WALL MASK DATA ===');
        status.textContent = 'Loading wall gaussians from metadata...';

        const collected = collectWallGaussians();

        if (!collected) {
            status.textContent = 'No wall gaussians found in metadata!';
            return false;
        }

        console.log(`✅ Loaded ${wallGaussianPositions.length} wall gaussians`);

        status.innerHTML = `<strong>Wall Detected!</strong><br>
            ${wallGaussianPositions.length.toLocaleString()} gaussians detected`;
        return true;
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
        console.error(error);
        return false;
    }
}
