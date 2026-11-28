#!/usr/bin/env python3
"""sheet.py <out-name> <cols> tag:frame tag:frame ...  -> out/stills/sb_<out-name>.png"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
def label_font(size):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', size)
    except OSError: return ImageFont.load_default()
F = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(F, 'out/stills'), exist_ok=True)
name, cols, items = sys.argv[1], int(sys.argv[2]), [a.split(':') for a in sys.argv[3:]]
CW = int(os.environ.get('CW', '640')); CH = CW * 9 // 16; pad, bar = 6, 20
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (cols * CW + (cols + 1) * pad, rows * (CH + bar + pad) + pad), (40, 36, 36))
d = ImageDraw.Draw(sheet); font = label_font(13)
for i, (tag, fr) in enumerate(items):
    r, c = divmod(i, cols); x, y = pad + c * (CW + pad), pad + r * (CH + bar + pad)
    d.text((x + 3, y + 3), f'{tag} f{fr}', fill=(253, 252, 252), font=font)
    f = os.path.join(F, 'out/stills', f'{tag}_{int(fr):04d}.png')
    if os.path.exists(f): sheet.paste(Image.open(f).convert('RGB').resize((CW, CH), Image.LANCZOS), (x, y + bar))
out = os.path.join(F, 'out/stills', f'sb_{name}.png'); sheet.save(out); print(out, sheet.size)
