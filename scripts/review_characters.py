import os
from PIL import Image

def remove_light_background(img, threshold=240):
    img = img.convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    for item in datas:
        # Check if the pixel is light enough to be considered background
        # item is (R, G, B, A)
        if item[0] >= threshold and item[1] >= threshold and item[2] >= threshold:
            # Change all white/light pixels to transparent
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    return img

def process_images(input_dir, output_dir):
    if not os.path.exists(input_dir):
        print(f"Input directory not found: {input_dir}")
        return

    os.makedirs(output_dir, exist_ok=True)

    for filename in os.listdir(input_dir):
        if filename.lower().endswith(".png"):
            input_path = os.path.join(input_dir, filename)
            output_path = os.path.join(output_dir, filename)

            try:
                with Image.open(input_path) as img:
                    # Resize to EXACTLY 32x32 pixels using nearest neighbor
                    img_resized = img.resize((32, 32), Image.Resampling.NEAREST)
                    
                    # Remove light background
                    img_transparent = remove_light_background(img_resized)
                    
                    # Save to output directory
                    img_transparent.save(output_path, format="PNG")
                    print(f"Processed and saved: {output_path}")
            except Exception as e:
                print(f"Failed to process {input_path}: {e}")

def main():
    # Directories
    raw_player_dir = os.path.join("mods", "assets", "raw", "player")
    out_player_dir = os.path.join("mods", "assets", "player")
    
    raw_enemies_dir = os.path.join("mods", "assets", "raw", "enemies")
    out_enemies_dir = os.path.join("mods", "assets", "enemies")

    print("Reviewing player characters...")
    process_images(raw_player_dir, out_player_dir)

    print("Reviewing enemy characters...")
    process_images(raw_enemies_dir, out_enemies_dir)

if __name__ == "__main__":
    main()
