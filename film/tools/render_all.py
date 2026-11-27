#!/usr/bin/env python3
"""Render every chunk of the film to lossless intermediates (out/shots/NN_<shot>_<from>.mkv), in parallel.
   render_all.py [--par 3] [--only shotA,shotB:300] [--force shotA,shotB:300]
   Chunks whose file already has the right frame count are skipped unless forced; a chunk is named by its
   shot, or shot:first-frame when a shot is split (open, filt, panel)."""
import subprocess, os, sys, json, time, concurrent.futures as cf
F = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(F, 'out/shots'); os.makedirs(OUT, exist_ok=True)
JOBS = [('open', 0, 479), ('open', 480, 959), ('sources', 0, 479)]
JOBS += [(f'mode{i}', 0, n - 1) for i, n in zip(range(1, 10), [120, 120, 120, 120, 60, 60, 120, 120, 120])]
JOBS += [(f'mat{i}', 0, 239) for i in range(1, 5)]
JOBS += [('filt', 0, 299), ('filt', 300, 599)]
JOBS += [(f'combo{i}', 0, 59) for i in range(1, 7)]
JOBS += [('panel', 0, 239), ('panel', 240, 479)]
JOBS += [(f'pres{i}', 0, n - 1) for i, n in zip(range(1, 6), [120, 120, 120, 60, 60])]
JOBS += [('outro', 0, 479)]
assert sum(b - a + 1 for _, a, b in JOBS) == 5760
args = sys.argv[1:]
par = int(args[args.index('--par') + 1]) if '--par' in args else 3
force = set(args[args.index('--force') + 1].split(',')) if '--force' in args else set()
only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None

def path(i): s, a, b = JOBS[i]; return os.path.join(OUT, f'{i:02d}_{s}_{a:04d}.mkv')
def nframes(p):
    if not os.path.exists(p): return -1
    r = subprocess.run(['ffprobe', '-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', p], capture_output=True, text=True)
    try: return int(r.stdout.strip())
    except ValueError: return -1
def run(i):
    s, a, b = JOBS[i]; p = path(i); want = b - a + 1
    if s not in force and f'{s}:{a}' not in force and nframes(p) == want: return (i, 'skip', 0, '')
    t0 = time.time()
    r = subprocess.run(['node', os.path.join(F, 'tools/render.js'), s, '--video', p, '--from', str(a), '--to', str(b)], capture_output=True, text=True)
    ok = r.returncode == 0 and nframes(p) == want and 'pageerror' not in r.stdout
    return (i, 'ok' if ok else 'FAIL', time.time() - t0, (r.stdout[-600:] + r.stderr[-600:]) if not ok else r.stdout.strip().splitlines()[0][:200] if r.stdout.strip() else '')

todo = [i for i in range(len(JOBS)) if only is None or JOBS[i][0] in only or f'{JOBS[i][0]}:{JOBS[i][1]}' in only]
# longest first
todo.sort(key=lambda i: -(JOBS[i][2] - JOBS[i][1] + 1 + JOBS[i][1]))
t0 = time.time(); bad = 0
with cf.ThreadPoolExecutor(max_workers=par) as ex:
    for i, st, dt, msg in ex.map(run, todo):
        print(f'[{time.time() - t0:6.0f}s] {JOBS[i][0]:8s} {JOBS[i][1]:4d}-{JOBS[i][2]:4d} {st:5s} {dt:6.0f}s  {msg}', flush=True)
        bad += st == 'FAIL'
with open(os.path.join(OUT, 'list.txt'), 'w') as fh:
    for i in range(len(JOBS)): fh.write(f"file '{path(i)}'\n")
print('done, failures:', bad, 'total', round(time.time() - t0), 's')
sys.exit(1 if bad else 0)
