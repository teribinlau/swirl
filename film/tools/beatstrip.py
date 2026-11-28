#!/usr/bin/env python3
"""A strip of consecutive frames of one mode around the beat, to judge how it moves with the music.
   beatstrip.py <name> <MODE> [--start 1500] [--frames 0,3,6,...] [--preroll 240] [--cfg '{json}'] [--app <dir>] [--cols 6]
The mode runs exactly as the app ships it (its preset only). --app renders another build of the app (e.g. an
older checkout of public/) for a before/after pair. Output: out/stills/strip_<name>.png"""
import sys, os, json, subprocess
from PIL import Image, ImageDraw, ImageFont
F = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
def opt(k, d=None): return a[a.index('--' + k) + 1] if '--' + k in a else d
name, mode = a[0], a[1]
start = int(opt('start', 1500)); frames = [int(x) for x in opt('frames', '0,2,4,6,9,12,16,21,26,30,32,34,36,40,46,52,58,60').split(',')]
cfg = {'mode': mode, 'raw': True, 'start': start, 'frames': max(frames) + 1, 'preroll': int(opt('preroll', 240))}
cfg.update(json.loads(opt('cfg', '{}')))
env = dict(os.environ, SWIRL_SCALE=os.environ.get('SWIRL_SCALE', '0.75'))
if opt('app'): env['SWIRL_APP'] = opt('app')
r = subprocess.run(['node', os.path.join(F, 'tools/render.js'), 'look', '--stills', ','.join(map(str, frames)), '--tag', 'strip_' + name, '--cfg', json.dumps(cfg)], capture_output=True, text=True, env=env)
if r.returncode != 0 or 'pageerror' in r.stdout: print(r.stdout[-1500:], r.stderr[-1500:]); sys.exit(1)
cols = int(opt('cols', 6)); CW = int(os.environ.get('CW', '480')); CH = CW * 9 // 16; pad, bar = 4, 16
rows = (len(frames) + cols - 1) // cols
sheet = Image.new('RGB', (cols * CW + (cols + 1) * pad, rows * (CH + bar + pad) + pad), (40, 36, 36))
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 12)
except OSError: font = ImageFont.load_default()
for i, fr in enumerate(frames):
    rr, c = divmod(i, cols); x, y = pad + c * (CW + pad), pad + rr * (CH + bar + pad)
    g = start + fr; beat = (g % 30)
    d.text((x + 3, y + 1), f'+{fr}  ({beat * 1000 // 60} ms after the beat)' if beat else f'+{fr}  BEAT', fill=(253, 252, 252) if beat else (48, 209, 88), font=font)
    p = os.path.join(F, 'out/stills', f'strip_{name}_{fr:04d}.png')
    if os.path.exists(p): sheet.paste(Image.open(p).convert('RGB').resize((CW, CH), Image.LANCZOS), (x, y + bar))
out = os.path.join(F, 'out/stills', f'strip_{name}.png'); sheet.save(out); print(out, sheet.size, r.stdout.strip().splitlines()[0][:120])
