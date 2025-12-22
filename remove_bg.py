import os
from pathlib import Path
from rembg import remove
from PIL import Image

def remove_background_inplace(directory):
    """Remove background from all images in directory and save in place"""
    dir_path = Path(directory)

    # Get all image files
    image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
    image_files = [f for f in dir_path.iterdir() if f.suffix.lower() in image_extensions]

    print(f"Found {len(image_files)} images to process")

    for img_file in image_files:
        print(f"Processing: {img_file.name}...")

        try:
            # Read input image
            with open(img_file, 'rb') as input_file:
                input_data = input_file.read()

            # Remove background
            output_data = remove(input_data)

            # Save as PNG (to support transparency)
            output_path = img_file.with_suffix('.png')
            with open(output_path, 'wb') as output_file:
                output_file.write(output_data)

            # If original was jpg, remove it
            if img_file.suffix.lower() in {'.jpg', '.jpeg'}:
                img_file.unlink()
                print(f"  ✓ Saved as {output_path.name} (removed original {img_file.name})")
            else:
                print(f"  ✓ Saved as {output_path.name}")

        except Exception as e:
            print(f"  ✗ Error processing {img_file.name}: {e}")

    print("\nDone!")

if __name__ == "__main__":
    wallDecors_dir = "assets/wallDecors"
    remove_background_inplace(wallDecors_dir)
