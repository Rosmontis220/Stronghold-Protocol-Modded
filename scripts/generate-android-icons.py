from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parents[1]
base = root / 'android/app/src/main/res'
im = Image.open(root / 'icon.png').convert('RGBA')
bg = '#0c0f0e'
for folder, size in [('mipmap-mdpi',48),('mipmap-hdpi',72),('mipmap-xhdpi',96),('mipmap-xxhdpi',144),('mipmap-xxxhdpi',192)]:
    for name in ['ic_launcher.png','ic_launcher_round.png']:
        im.resize((size,size),Image.Resampling.LANCZOS).save(base/folder/name)
# All legacy orientation/density variants use a centered project emblem on the game background.
for dest in base.glob('drawable*/splash.png'):
    with Image.open(dest) as old: size = old.size
    canvas = Image.new('RGB',size,bg)
    side = max(64,int(min(size)*0.30))
    icon = im.resize((side,side),Image.Resampling.LANCZOS)
    canvas.paste(icon,((size[0]-side)//2,(size[1]-side)//2),icon)
    canvas.save(dest)
canvas = Image.new('RGBA',(288,288),bg)
icon = im.resize((176,176),Image.Resampling.LANCZOS)
canvas.paste(icon,(56,56),icon)
canvas.save(base/'drawable-nodpi/icon_launcher.png')
