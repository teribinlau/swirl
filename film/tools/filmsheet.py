#!/usr/bin/env python3
"""filmsheet.py <video> <name> <start_frame> <end_frame> <step> [cols]  -> out/stills/fs_<name>.png : contact sheet of frames from a video"""
import sys, os, subprocess, io
from PIL import Image, ImageDraw, ImageFont
def label_font(size):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', size)
    except OSError: return ImageFont.load_default()
F = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(F, 'out/stills'), exist_ok=True)
video, name = sys.argv[1], sys.argv[2]
if ',' in sys.argv[3]:
    FRAMES = [int(x) for x in sys.argv[3].split(',')]; sys.argv[3:4] = ['0', '0', '1']
else:
    FRAMES = None
a, b, step = int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 5
CW = int(os.environ.get('CW', '512')); CH = CW * 9 // 16; pad, bar = 4, 16
frames = FRAMES or list(range(a, b + 1, step))
rows = (len(frames) + cols - 1) // cols
sheet = Image.new('RGB', (cols * CW + (cols + 1) * pad, rows * (CH + bar + pad) + pad), (40, 36, 36))
d = ImageDraw.Draw(sheet); font = label_font(12)
for i, fr in enumerate(frames):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{fr / 60:.5f}', '-i', video, '-frames:v', '1', '-vf', f'scale={CW}:{CH}:flags=lanczos', '-f', 'image2pipe', '-c:v', 'png', '-'], capture_output=True)
    rr, c = divmod(i, cols); x, y = pad + c * (CW + pad), pad + rr * (CH + bar + pad)
    d.text((x + 3, y + 1), f'f{fr}  {fr / 60:.2f}s  bar {fr // 120 + 1}.{(fr % 120) // 30 + 1}', fill=(253, 252, 252), font=font)
    if r.stdout: sheet.paste(Image.open(io.BytesIO(r.stdout)).convert('RGB'), (x, y + bar))
out = os.path.join(F, 'out/stills', f'fs_{name}.png'); sheet.save(out); print(out, sheet.size)
