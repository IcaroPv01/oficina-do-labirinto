import os
from PIL import Image

def process_images(input_dir, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    if not os.path.exists(input_dir):
        print(f"Directory {input_dir} does not exist.")
        return

    for filename in os.listdir(input_dir):
        if filename.lower().endswith(".png"):
            input_path = os.path.join(input_dir, filename)
            output_path = os.path.join(output_dir, filename)
            
            try:
                # Open image and ensure it has an alpha channel
                img = Image.open(input_path).convert("RGBA")
                
                # Resize the image to EXACTLY 32x32 pixels (using nearest neighbor)
                img = img.resize((32, 32), Image.Resampling.NEAREST if hasattr(Image, 'Resampling') else Image.NEAREST)
                
                # Remove white/light background pixels (make transparent)
                data = img.getdata()
                new_data = []
                for item in data:
                    # Check if the pixel is white/light (e.g. RGB all > 240)
                    if item[0] > 240 and item[1] > 240 and item[2] > 240:
                        # Make transparent
                        new_data.append((255, 255, 255, 0))
                    else:
                        new_data.append(item)
                
                img.putdata(new_data)
                
                # Save the final processed image
                img.save(output_path, "PNG")
                print(f"Processed and saved: {output_path}")
            except Exception as e:
                print(f"Error processing {filename}: {e}")

if __name__ == "__main__":
    # Base paths relative to the project root
    raw_world_dir = os.path.join("mods", "assets", "raw", "world")
    raw_items_dir = os.path.join("mods", "assets", "raw", "items")
    
    out_world_dir = os.path.join("mods", "assets", "world")
    out_items_dir = os.path.join("mods", "assets", "items")

    print(f"Processing world assets from {raw_world_dir} to {out_world_dir}")
    process_images(raw_world_dir, out_world_dir)
    
    print(f"Processing items assets from {raw_items_dir} to {out_items_dir}")
    process_images(raw_items_dir, out_items_dir)
