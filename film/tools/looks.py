#!/usr/bin/env python3
"""Batch look-dev: looks.py <sheet-name> <cols> then lines 'label|{json cfg}' on stdin. Runs 3 renders at a time, builds a contact sheet."""
import sys, json, subprocess, os, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
def label_font(size):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', size)
    except OSError: return ImageFont.load_default()
F = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(F, 'out/stills'), exist_ok=True)
name, cols = sys.argv[1], int(sys.argv[2])
jobs = []
for i, line in enumerate(l for l in sys.stdin.read().splitlines() if l.strip()):
    label, cfg = line.split('|', 1); cfg = json.loads(cfg)
    jobs.append((i, label.strip(), cfg))
def run(job):
    i, label, cfg = job
    tag = f'{name}_{i:02d}'
    fr = cfg.get('frames', 1) - 1
    r = subprocess.run(['node', os.path.join(F, 'tools/render.js'), 'look', '--stills', str(fr), '--tag', tag, '--cfg', json.dumps(cfg)], capture_output=True, text=True)
    if r.returncode != 0 or 'pageerror' in r.stdout: print('ERR', label, r.stdout[-400:], r.stderr[-400:])
    return os.path.join(F, 'out/stills', f'{tag}_{fr:04d}.png')
with cf.ThreadPoolExecutor(max_workers=int(os.environ.get('PAR', '3'))) as ex: files = list(ex.map(run, jobs))
CW = int(os.environ.get('CW', '640')); CH = CW * 9 // 16; pad, bar = 6, 24
rows = (len(jobs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * CW + (cols + 1) * pad, rows * (CH + bar + pad) + pad), (24, 22, 22))
d = ImageDraw.Draw(sheet); font = label_font(14)
for (i, label, cfg), f in zip(jobs, files):
    r, c = divmod(i, cols); x, y = pad + c * (CW + pad), pad + r * (CH + bar + pad)
    d.text((x + 3, y + 4), label, fill=(253, 252, 252), font=font)
    if os.path.exists(f): sheet.paste(Image.open(f).convert('RGB').resize((CW, CH), Image.LANCZOS), (x, y + bar))
out = os.path.join(F, 'out/stills', f'sheet_{name}.png'); sheet.save(out); print(out, sheet.size)
