import * as THREE from 'three';
import { viewer, wallClusters } from './utils.js';

// Store wall markers
let wallMarkers = [];
let animationFrameId = null;

/**
 * Create 3D text sprite for wall label
 */
function createTextSprite(text, position) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;

    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.9)';
    context.roundRect(10, 10, 236, 108, 15);
    context.fill();

    // Border
    context.strokeStyle = '#00ff88';
    context.lineWidth = 4;
    context.roundRect(10, 10, 236, 108, 15);
    context.stroke();

    // Text
    context.fillStyle = '#00ff88';
    context.font = 'bold 56px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.8, 0.4, 1);
    sprite.position.copy(position);
    sprite.renderOrder = 999;

    return sprite;
}

/**
 * Create a point cloud visualization of the wall
 */
function createWallPointCloud(wall, color) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(wall.gaussians.length * 3);

    wall.gaussians.forEach((pos, i) => {
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: color,
        size: 0.03,
        transparent: true,
        opacity: 0.3,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    points.userData.wallId = wall.id;
    points.userData.wall = wall;
    points.userData.isWallCloud = true;
    points.renderOrder = -1; // Render behind everything

    return points;
}

/**
 * Calculate wall dimensions from gaussians
 */
function calculateWallBounds(wall) {
    const gaussians = wall.gaussians;
    if (gaussians.length === 0) return { width: 2, height: 2 };

    // Calculate bounds in wall's local coordinate system
    const normal = wall.normal.clone();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const actualUp = new THREE.Vector3().crossVectors(normal, right).normalize();

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (const pos of gaussians) {
        const localPos = pos.clone().sub(wall.centroid);
        const u = localPos.dot(right);
        const v = localPos.dot(actualUp);

        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
    }

    const width = maxU - minU;
    const height = maxV - minV;

    return {
        width: Math.max(width, 1),
        height: Math.max(height, 1),
        centerU: (minU + maxU) / 2,
        centerV: (minV + minV) / 2,
        right,
        up: actualUp
    };
}

/**
 * Create large invisible clickable plane for wall
 */
function createClickablePlane(wall, color) {
    const bounds = calculateWallBounds(wall);

    // Create a plane geometry sized to the wall
    const geometry = new THREE.PlaneGeometry(bounds.width, bounds.height);

    // Make it semi-transparent for visibility
    const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false
    });

    const plane = new THREE.Mesh(geometry, material);

    // Position and orient the plane
    plane.position.copy(wall.centroid);
    plane.position.addScaledVector(wall.normal, 0.05);

    // Orient plane to face outward from wall
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, wall.normal).normalize();
    const up = new THREE.Vector3().crossVectors(wall.normal, right).normalize();

    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, up, wall.normal);
    plane.quaternion.setFromRotationMatrix(matrix);

    plane.userData.wallId = wall.id;
    plane.userData.wall = wall;
    plane.userData.isClickable = true;
    plane.renderOrder = 900;

    return plane;
}

/**
 * Create clickable marker for wall selection
 */
function createWallMarker(wall, colorHex) {
    const markers = [];

    // Create large clickable plane (MAIN CLICKABLE AREA)
    const clickablePlane = createClickablePlane(wall, colorHex);
    markers.push(clickablePlane);

    // Position for ring marker
    const position = wall.centroid.clone();
    position.addScaledVector(wall.normal, 0.15);

    // Create pulsing ring
    const ringGeometry = new THREE.RingGeometry(0.3, 0.45, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position);

    // Orient ring to face camera
    const normal = wall.normal.clone();
    ring.lookAt(ring.position.clone().add(normal));
    ring.userData.wallId = wall.id;
    ring.userData.wall = wall;
    ring.userData.isPulseRing = true;
    ring.userData.isClickable = true;
    ring.userData.initialOpacity = 0.6;
    ring.renderOrder = 997;
    markers.push(ring);

    // Create subtle point cloud overlay (for visual feedback only)
    const pointCloud = createWallPointCloud(wall, colorHex);
    markers.push(pointCloud);

    return markers;
}

/**
 * Animate pulsing effect for markers
 */
function animateMarkers() {
    const time = Date.now() * 0.003;

    wallMarkers.forEach(marker => {
        if (marker.userData.isPulseRing) {
            // Pulsing opacity
            const pulse = Math.sin(time * 2) * 0.3 + 0.7;
            marker.material.opacity = marker.userData.initialOpacity * pulse;

            // Pulsing scale
            const scale = 1 + Math.sin(time * 2) * 0.2;
            marker.scale.set(scale, scale, scale);
        }
    });

    animationFrameId = requestAnimationFrame(animateMarkers);
}

/**
 * Show wall selection markers
 */
export function showWallMarkers() {
    // Clear existing markers
    clearWallMarkers();

    if (wallClusters.length === 0) {
        console.warn('No wall clusters available');
        return [];
    }

    console.log(`ðŸ“ Creating markers for ${wallClusters.length} walls`);

    // Different colors for each wall
    const colors = [0x00ff88, 0xff6b6b, 0x4dabf7, 0xffd43b, 0xbe4bdb, 0x06ffa5];

    wallClusters.forEach((wall, index) => {
        const colorHex = colors[index % colors.length];
        const markers = createWallMarker(wall, colorHex);

        markers.forEach(marker => {
            viewer.threeScene.add(marker);
            wallMarkers.push(marker);
        });
    });

    // Start animation
    if (animationFrameId === null) {
        animateMarkers();
    }

    console.log(`âœ… Created ${wallMarkers.length} marker objects for ${wallClusters.length} walls`);
    return wallMarkers;
}

/**
 * Clear all wall markers
 */
export function clearWallMarkers() {
    // Stop animation
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    wallMarkers.forEach(marker => {
        if (marker.geometry) marker.geometry.dispose();
        if (marker.material) {
            if (marker.material.map) marker.material.map.dispose();
            marker.material.dispose();
        }
        viewer.threeScene.remove(marker);
    });
    wallMarkers = [];
}

/**
 * Check if mouse intersects a wall marker
 */
export function raycastWallMarkers(event) {
    if (wallMarkers.length === 0) return null;

    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, viewer.camera);

    // Check clickable objects (planes, spheres, rings)
    const clickableObjects = wallMarkers.filter(m => m.userData.isClickable);

    const intersects = raycaster.intersectObjects(clickableObjects, false);

    if (intersects.length > 0) {
        console.log(`âœ… Clicked on Wall ${intersects[0].object.userData.wall.id}`);
        return intersects[0].object.userData.wall;
    }

    return null;
}

/**
 * Highlight a wall marker
 */
export function highlightWallMarker(wallId) {
    wallMarkers.forEach(marker => {
        if (marker.userData.wallId === wallId) {
            if (marker.userData.isClickable && !marker.userData.isPulseRing) {
                // Brighten the clickable plane
                marker.material.opacity = Math.min(marker.material.opacity * 1.5, 0.5);
            } else if (marker.userData.isWallCloud) {
                // Highlight point cloud
                marker.material.opacity = 0.5;
                marker.material.size = 0.04;
            }
        }
    });
}

/**
 * Reset all wall marker highlights
 */
export function resetWallMarkerHighlights() {
    wallMarkers.forEach(marker => {
        if (marker.userData.isClickable && !marker.userData.isPulseRing) {
            if (marker.geometry.type === 'PlaneGeometry') {
                marker.material.opacity = 0.2;
            }
        } else if (marker.userData.isWallCloud) {
            marker.material.opacity = 0.3;
            marker.material.size = 0.03;
        }
    });
}

export { wallMarkers };