#!/usr/bin/env python3
"""motioncheck.py <video>: frame-to-frame difference analysis — finds frozen frames and unexpected single-frame jumps."""
import sys, subprocess, numpy as np
W, H = 320, 180
r = subprocess.run(['ffmpeg', '-v', 'error', '-i', sys.argv[1], '-vf', f'scale={W}:{H}:flags=area,format=gray', '-f', 'rawvideo', '-'], capture_output=True)
a = np.frombuffer(r.stdout, np.uint8).reshape(-1, H, W).astype(np.int16)
n = len(a); d = np.abs(a[1:] - a[:-1]).mean(axis=(1, 2))          # d[i] = diff between frame i and i+1
print('frames', n, 'median diff', round(float(np.median(d)), 3))
CUTS = set()
for s, lens in [(1440, [120, 120, 120, 120, 60, 60, 120, 120, 120]), (2400, [240] * 4), (3360, [600] + [60] * 6), (4320, [480]), (4800, [120, 120, 120, 60, 60]), (5280, [480])]:
    f = s
    for L in lens: CUTS.add(f); f += L
CUTS |= {960}
FILT = {3360 + x for x in [60, 120, 180, 240, 300, 360, 420, 480, 510, 540, 570]}
known = CUTS | FILT | {716 + 0, 1080, 2460, 2760}
# frozen: consecutive frames identical while the picture is not black
bright = a.mean(axis=(1, 2))
frozen = [i + 1 for i in range(n - 1) if d[i] < 0.02 and bright[i] > 4]
def runs(xs):
    out = []; 
    for x in xs:
        if out and x == out[-1][1] + 1: out[-1][1] = x
        else: out.append([x, x])
    return out
print('frozen frame runs (first..last):', [(a_, b_) for a_, b_ in runs(frozen)][:40])
# jumps: diff much larger than both neighbours, not at a known cut
jumps = []
for i in range(2, n - 3):
    loc = np.median(np.r_[d[i - 6:i], d[i + 1:i + 7]]) if i > 6 and i < n - 8 else np.median(d)
    if d[i] > 6 and d[i] > 4 * (loc + 0.3) and (i + 1) not in known: jumps.append((i + 1, round(float(d[i]), 1), round(float(loc), 2)))
print('unexpected jumps (frame, diff, local median):', jumps)
print('diff at known cuts:', {c: round(float(d[c - 1]), 1) for c in sorted(known) if 0 < c < n})
