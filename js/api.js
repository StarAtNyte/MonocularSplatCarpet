import * as THREE from 'three';
import {
    viewer,
    generatedSplatData,
    floorMaskData,
    wallMaskData,
    setGeneratedSplatData,
    setFloorMaskData,
    setWallMaskData,
    setFloorOrientation,
    setSplatLoaded
} from './utils.js';
import JSZip from 'jszip';

/**
 * Call the Sharp API to generate splat from image
 */
export async function generateSplatFromImage(imageFile, cleanupSceneFunc) {
    const status = document.getElementById('status');
    const generateBtn = document.getElementById('generateSplatBtn');

    status.style.display = 'block';
    status.classList.add('loading');
    status.textContent = 'Uploading image to API...';

    // Disable button and show loading state
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    try {
        const formData = new FormData();
        formData.append('file', imageFile);

        const apiUrl = 'https://nitizkhanal00--sharp-api-myroom-v2-fastapi-app.modal.run/predict';

        status.innerHTML = '<strong>Generating splat...</strong><br>This may take 1-2 minutes. Please wait.';

        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }

        // Stream and parse JSON incrementally to avoid blocking
        status.innerHTML = '<strong>Processing API response...</strong><br>Receiving data...';

        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;

            // Update progress
            const mb = (receivedLength / 1024 / 1024).toFixed(2);
            status.innerHTML = `<strong>Processing API response...</strong><br>Received ${mb} MB...`;

            // Yield to UI
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Combine chunks
        status.textContent = 'Parsing response data...';
        const chunksAll = new Uint8Array(receivedLength);
        let position = 0;
        for (let chunk of chunks) {
            chunksAll.set(chunk, position);
            position += chunk.length;
        }

        // Decode to string and parse JSON
        const text = new TextDecoder("utf-8").decode(chunksAll);
        const result = JSON.parse(text);

        // Store base64 data
        setGeneratedSplatData(result.ply);
        setFloorMaskData(result.floor_mask_3d);
        setWallMaskData(result.wall_mask_3d);

        console.log('Response size:', receivedLength, 'bytes (', (receivedLength / 1024 / 1024).toFixed(2), 'MB)');

        // Log floor mask info
        if (result.floor_mask_3d) {
            console.log('Floor mask 3D received:', result.floor_mask_3d.length, 'values');
            console.log('Floor coverage 3D:', (result.floor_coverage_3d * 100).toFixed(1) + '%');
        }
        // Log wall mask info
        if (result.wall_mask_3d) {
            console.log('Wall mask 3D received:', result.wall_mask_3d.length, 'values');
            console.log('Wall coverage 3D:', (result.wall_coverage_3d * 100).toFixed(1) + '%');
        }
        if (result.gaussian_grid_info) {
            console.log('Gaussian grid info:', result.gaussian_grid_info);
        }

        // Always use front view / horizontal floor orientation for generated splats
        const viewType = 'front';
        setFloorOrientation('horizontal');

        console.log('View type:', viewType, '→ Floor orientation: horizontal');
        status.innerHTML = `<strong>Loading splat...</strong>`;

        // Load the generated splat
        loadGeneratedSplat(cleanupSceneFunc);

    } catch (error) {
        console.error('Error generating splat:', error);
        status.classList.remove('loading');
        status.innerHTML = `<strong>Error:</strong> ${error.message}`;

        // Re-enable button on error
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Splat';
    }
}

/**
 * Load the generated splat from API response
 */
export async function loadGeneratedSplat(cleanupSceneFunc) {
    if (!generatedSplatData) {
        console.error('No generated splat data available');
        return;
    }

    const status = document.getElementById('status');
    const generateBtn = document.getElementById('generateSplatBtn');

    try {
        status.textContent = 'Preparing splat data...';

        // Use data URL approach
        const dataUrl = `data:application/octet-stream;base64,${generatedSplatData}#generated.ply`;

        console.log('Created data URL for PLY data, size:', generatedSplatData.length, 'chars');

        status.textContent = 'Cleaning up old scene...';

        // Clean up old scene but keep mask data (already set from API response)
        cleanupSceneFunc(false);

        // Remove old splat
        if (viewer.splatMesh) {
            await viewer.removeSplatScene(0);
        }

        setSplatLoaded(false);

        status.textContent = 'Loading new splat scene...';

        console.log('Loading splat from data URL');

        const loadPromise = viewer.addSplatScene(dataUrl, {
            progressiveLoad: true
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Loading timeout after 30s')), 30000)
        );

        await Promise.race([loadPromise, timeoutPromise]);

        viewer.start();
        setSplatLoaded(true);

        // Position camera to view splat like an image (matching splat.html)
        const cameraPosition = new THREE.Vector3(-0.24324, -0.08784, 0.72614);
        const lookAtPoint = new THREE.Vector3(-0.24324, -0.08784, 4.05811);
        viewer.camera.position.copy(cameraPosition);
        viewer.camera.lookAt(lookAtPoint);
        if (viewer.controls) {
            viewer.controls.target.copy(lookAtPoint);
            viewer.controls.update();
        }

        // Enable floor detection button with appropriate text
        const toggleFloorBtn = document.getElementById('toggleFloorBtn');
        toggleFloorBtn.disabled = false;
        toggleFloorBtn.textContent = (floorMaskData && Array.isArray(floorMaskData)) ? 'Show Floor Plane' : 'Show Floor Detection';

        // Enable wall detection button with appropriate text
        const toggleWallBtn = document.getElementById('toggleWallBtn');
        toggleWallBtn.disabled = false;
        toggleWallBtn.textContent = (wallMaskData && Array.isArray(wallMaskData)) ? 'Show Wall Gaussians' : 'Show Wall Detection';

        // Enable wall clusters button
        const showWallClustersBtn = document.getElementById('showWallClustersBtn');
        showWallClustersBtn.disabled = false;
        showWallClustersBtn.textContent = 'Show Wall Clusters';

        // Camera controls remain in their current state (locked/unlocked via UI button)

        status.classList.remove('loading');
        status.innerHTML = '<strong>Splat loaded successfully!</strong><br>Click "Place Rug" to select and place a rug on the floor.';

        // Re-enable button
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Splat';

        // Enable download buttons
        document.getElementById('downloadPlyBtn').disabled = false;
        document.getElementById('debugDownloadPlyBtn').disabled = false;

    } catch (error) {
        console.error('Error loading generated splat:', error);
        status.classList.remove('loading');
        status.innerHTML = `<strong>Error loading splat:</strong> ${error.message}`;

        // Re-enable button on error
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate Splat';
    }
}

/**
 * Download the generated splat as a ZIP file with PLY and mask data
 */
export async function downloadGeneratedPLY() {
    if (!generatedSplatData) {
        alert('No PLY data available. Please generate a splat first.');
        return;
    }

    try {
        console.log('Creating ZIP package with PLY and mask data...');

        const zip = new JSZip();

        // Add the PLY file
        const binaryString = atob(generatedSplatData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        zip.file('room.ply', bytes);

        // Add metadata JSON with floor and wall masks
        const metadata = {
            version: '1.0',
            type: 'sharp-room-splat',
            created: new Date().toISOString(),
            floorMask: floorMaskData || null,
            wallMask: wallMaskData || null
        };

        zip.file('metadata.json', JSON.stringify(metadata, null, 2));

        // Generate ZIP blob
        const blob = await zip.generateAsync({ type: 'blob' });

        // Download ZIP file
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'generated_room.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('ZIP package downloaded: generated_room.zip');
        console.log('  - room.ply:', (bytes.length / 1024).toFixed(2), 'KB');
        console.log('  - metadata.json with floor mask:', floorMaskData ? floorMaskData.length : 0, 'values');
        console.log('  - metadata.json with wall mask:', wallMaskData ? wallMaskData.length : 0, 'values');
    } catch (error) {
        console.error('Error creating ZIP package:', error);
        alert('Error creating download package: ' + error.message);
    }
}

/**
 * Load a splat from a folder (containing room.ply + metadata.json)
 */
export async function loadSplatFromFolder(folderPath, cleanupSceneFunc) {
    const status = document.getElementById('status');

    try {
        status.style.display = 'block';
        status.textContent = 'Loading room...';

        console.log('=== LOADING SPLAT FROM FOLDER ===');
        console.log('Folder path:', folderPath);

        // Fetch metadata.json
        const metadataUrl = `${folderPath}/metadata.json`;
        status.textContent = 'Loading metadata...';

        const metadataResponse = await fetch(metadataUrl);
        if (!metadataResponse.ok) {
            throw new Error(`Could not load metadata.json from ${metadataUrl}`);
        }

        const metadata = await metadataResponse.json();
        console.log('Metadata loaded:', metadata);

        // Load the PLY file
        const plyUrl = `${folderPath}/room.ply`;
        status.textContent = 'Loading splat scene...';

        // Clean up old scene FIRST - clear everything including old mask data
        cleanupSceneFunc(true);

        // Then set the NEW scene's mask data
        setFloorMaskData(metadata.floorMask || null);
        setWallMaskData(metadata.wallMask || null);
        setFloorOrientation('horizontal');

        console.log('Floor mask:', metadata.floorMask ? metadata.floorMask.length : 0, 'values');
        console.log('Wall mask:', metadata.wallMask ? metadata.wallMask.length : 0, 'values');

        // Remove old splat
        if (viewer.splatMesh) {
            await viewer.removeSplatScene(0);
        }

        setSplatLoaded(false);

        console.log('Loading PLY from:', plyUrl);

        await viewer.addSplatScene(plyUrl, {
            progressiveLoad: true
        });

        viewer.start();
        setSplatLoaded(true);

        // Position camera to view splat like an image (matching splat.html)
        const cameraPosition = new THREE.Vector3(-0.24324, -0.08784, 0.72614);
        const lookAtPoint = new THREE.Vector3(-0.24324, -0.08784, 4.05811);
        viewer.camera.position.copy(cameraPosition);
        viewer.camera.lookAt(lookAtPoint);
        if (viewer.controls) {
            viewer.controls.target.copy(lookAtPoint);
            viewer.controls.update();
        }

        // Enable floor detection button
        const toggleFloorBtn = document.getElementById('toggleFloorBtn');
        toggleFloorBtn.disabled = false;
        toggleFloorBtn.textContent = 'Show Floor Detection';

        // Enable wall detection button
        const toggleWallBtn = document.getElementById('toggleWallBtn');
        toggleWallBtn.disabled = false;
        toggleWallBtn.textContent = 'Show Wall Detection';

        // Enable wall clusters button
        const showWallClustersBtn = document.getElementById('showWallClustersBtn');
        showWallClustersBtn.disabled = false;
        showWallClustersBtn.textContent = 'Show Wall Clusters';

        // Camera controls remain in their current state (locked/unlocked via UI button)

        status.textContent = 'Room loaded! Click "Place Rug" to select and place a rug.';
        console.log('✅ Splat loaded from folder successfully!');

    } catch (error) {
        console.error('Error loading from folder:', error);
        status.textContent = `Error loading room: ${error.message}`;
        throw error;
    }
}

/**
 * Load a splat from ZIP file (containing PLY + metadata with masks)
 */
export async function loadSplatFromZip(zipFile, cleanupSceneFunc) {
    const status = document.getElementById('status');

    try {
        status.style.display = 'block';
        status.textContent = 'Loading ZIP file...';

        console.log('=== LOADING SPLAT FROM ZIP ===');

        const zip = new JSZip();
        const zipContents = await zip.loadAsync(zipFile);

        // Extract the PLY file
        const plyFile = zipContents.file('room.ply');
        if (!plyFile) {
            throw new Error('ZIP file does not contain room.ply');
        }

        status.textContent = 'Extracting PLY data...';
        const plyBlob = await plyFile.async('blob');
        const plyArrayBuffer = await plyBlob.arrayBuffer();
        const plyBytes = new Uint8Array(plyArrayBuffer);

        // Convert to base64 for storage
        let base64String = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < plyBytes.length; i += chunkSize) {
            const chunk = plyBytes.subarray(i, i + chunkSize);
            base64String += String.fromCharCode.apply(null, chunk);
        }
        const plyBase64 = btoa(base64String);

        console.log('PLY extracted:', (plyBytes.length / 1024).toFixed(2), 'KB');

        // Extract metadata (floor and wall masks)
        const metadataFile = zipContents.file('metadata.json');
        let floorMask = null;
        let wallMask = null;

        if (metadataFile) {
            status.textContent = 'Loading floor and wall masks...';
            const metadataText = await metadataFile.async('text');
            const metadata = JSON.parse(metadataText);

            floorMask = metadata.floorMask || null;
            wallMask = metadata.wallMask || null;

            console.log('Metadata loaded:');
            console.log('  - Floor mask:', floorMask ? floorMask.length : 0, 'values');
            console.log('  - Wall mask:', wallMask ? wallMask.length : 0, 'values');
        } else {
            console.warn('No metadata.json found in ZIP - masks will not be available');
        }

        // Store the data
        setGeneratedSplatData(plyBase64);
        setFloorMaskData(floorMask);
        setWallMaskData(wallMask);
        setFloorOrientation('horizontal');

        // Load the splat
        status.textContent = 'Loading splat scene...';
        await loadGeneratedSplat(cleanupSceneFunc);

        console.log('✅ Splat loaded from ZIP successfully!');

    } catch (error) {
        console.error('Error loading ZIP file:', error);
        status.textContent = `Error loading ZIP: ${error.message}`;
        throw error;
    }
}
