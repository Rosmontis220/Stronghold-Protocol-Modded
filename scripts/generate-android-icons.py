from PIL import Image
from pathlib import Path
src = Path(__file__).resolve().parents[1] / 'icon.png'
base = Path(__file__).resolve().parents[1] / 'android' / 'app' / 'src' / 'main' / 'res'
im = Image.open(src).convert('RGBA')
for folder, size in [('mipmap-mdpi', 48), ('mipmap-hdpi', 72), ('mipmap-xhdpi', 96), ('mipmap-xxhdpi', 144), ('mipmap-xxxhdpi', 192)]:
    im.resize((size, size), Image.Resampling.LANCZOS).save(base / folder / 'ic_launcher_round.png')
