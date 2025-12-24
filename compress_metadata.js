/**
 * Utility script to compress existing metadata.json files
 * Converts boolean arrays to bitpacked format (8x smaller)
 *
 * Usage: node compress_metadata.js <path-to-metadata.json>
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Pack boolean array into binary format (1 bit per boolean)
 */
function packBooleanArray(boolArray) {
    const numBits = boolArray.length;
    const numBytes = Math.ceil(numBits / 8);
    const packed = new Uint8Array(numBytes);

    for (let i = 0; i < numBits; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8); // MSB first (numpy packbits convention)
        if (boolArray[i]) {
            packed[byteIndex] |= (1 << bitIndex);
        }
    }

    return packed;
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(uint8Array) {
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    return Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Compress metadata.json file
 */
function compressMetadata(inputPath) {
    console.log(`Reading ${inputPath}...`);
    const metadata = JSON.parse(readFileSync(inputPath, 'utf-8'));

    const originalSize = Buffer.byteLength(JSON.stringify(metadata));
    console.log(`Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

    // Compress floor mask
    if (metadata.floorMask && Array.isArray(metadata.floorMask)) {
        console.log(`Compressing floor mask (${metadata.floorMask.length} booleans)...`);
        const floorMaskLength = metadata.floorMask.length;
        const packedFloor = packBooleanArray(metadata.floorMask);
        const base64Floor = uint8ArrayToBase64(packedFloor);

        console.log(`  Floor mask: ${metadata.floorMask.length} booleans → ${packedFloor.length} bytes (${(packedFloor.length / 1024).toFixed(2)} KB)`);

        metadata.floorMask = base64Floor;
        metadata.floorMaskLength = floorMaskLength;
    }

    // Compress wall mask
    if (metadata.wallMask && Array.isArray(metadata.wallMask)) {
        console.log(`Compressing wall mask (${metadata.wallMask.length} booleans)...`);
        const wallMaskLength = metadata.wallMask.length;
        const packedWall = packBooleanArray(metadata.wallMask);
        const base64Wall = uint8ArrayToBase64(packedWall);

        console.log(`  Wall mask: ${metadata.wallMask.length} booleans → ${packedWall.length} bytes (${(packedWall.length / 1024).toFixed(2)} KB)`);

        metadata.wallMask = base64Wall;
        metadata.wallMaskLength = wallMaskLength;
    }

    // Update version
    metadata.version = '2.0';

    // Save compressed version
    const outputPath = inputPath.replace('.json', '.compressed.json');
    const compressedJson = JSON.stringify(metadata, null, 2);
    writeFileSync(outputPath, compressedJson);

    const compressedSize = Buffer.byteLength(compressedJson);
    const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    console.log(`\nCompressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Size reduction: ${reduction}%`);
    console.log(`Saved to: ${outputPath}`);

    // Optionally replace original
    console.log(`\nTo replace the original file, run:`);
    console.log(`  move "${outputPath}" "${inputPath}"`);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('Usage: node compress_metadata.js <path-to-metadata.json>');
    console.log('\nExample:');
    console.log('  node compress_metadata.js splats/room1/metadata.json');
    console.log('  node compress_metadata.js splats/room2/metadata.json');
    process.exit(1);
}

const inputPath = resolve(args[0]);
compressMetadata(inputPath);
