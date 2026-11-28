# Visual + numeric check of the soundtrack: spectrogram, envelope and band balance.
#   python3 tools/audio_report.py audio/music.wav out/audio_report.png
import sys, numpy as np
from scipy.io import wavfile
from scipy import signal
from PIL import Image, ImageDraw, ImageFont
sr, x = wavfile.read(sys.argv[1]); x = x.astype(np.float64).T
mono = x.mean(axis=0)
# --- spectrogram, log frequency 30 Hz..20 kHz
f, t, S = signal.stft(mono, sr, nperseg=4096, noverlap=4096 - 1024, window='hann')
P = 20 * np.log10(np.abs(S) + 1e-9)
W, H = 1920, 520
freqs = np.geomspace(30, 20000, H)
ti = np.linspace(0, len(t) - 1, W).astype(int)
img = np.zeros((H, W))
for r, fq in enumerate(freqs):
    k = int(round(fq / (sr / 4096)))
    k2 = max(k + 1, int(round(fq * 1.012 / (sr / 4096))))
    img[H - 1 - r] = P[k:k2, :].max(axis=0)[ti]
v = np.clip((img + 95) / 75, 0, 1)
rgb = np.stack([np.clip(v * 3 - 1.0, 0, 1), np.clip(v * 3 - 2.0, 0, 1) * 0.9 + v * 0.1, np.clip(v * 2.0, 0, 1) * (1 - 0.5 * np.clip(v * 3 - 1.5, 0, 1))], axis=-1)
im = Image.fromarray((rgb * 255).astype(np.uint8))
out = Image.new('RGB', (W, H + 300), (16, 14, 14)); out.paste(im, (0, 0))
d = ImageDraw.Draw(out)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 13)
except OSError: font = ImageFont.load_default()
for fq in (60, 200, 500, 1500, 3000, 6000, 12000):      # the app's band edges
    y = H - 1 - int(np.searchsorted(freqs, fq)); d.line([(0, y), (W, y)], fill=(255, 255, 255), width=1); d.text((4, y - 15), f'{fq} Hz', fill=(255, 255, 255), font=font)
dur = len(mono) / sr
for bar in range(1, 49, 4):
    xpx = int((bar - 1) * 2.0 / dur * W); d.line([(xpx, 0), (xpx, H + 300)], fill=(120, 120, 120), width=1); d.text((xpx + 3, H + 2), f'bar {bar}', fill=(200, 200, 200), font=font)
# --- waveform envelope + short-term RMS
blk = len(mono) // W
env = np.abs(x[:, :blk * W]).reshape(2, W, blk).max(axis=(0, 2)); rms = np.sqrt((mono[:blk * W].reshape(W, blk) ** 2).mean(axis=1))
for i in range(W):
    d.line([(i, H + 160 - env[i] * 130), (i, H + 160 + env[i] * 130)], fill=(253, 252, 252))
    d.point((i, H + 160 - rms[i] * 130), fill=(255, 80, 60)); d.point((i, H + 160 + rms[i] * 130), fill=(255, 80, 60))
out.save(sys.argv[2])
# --- numbers
print('dc offset %.5f  stereo correlation %.2f' % (mono.mean(), np.corrcoef(x[0], x[1])[0, 1]))
a, b = int(24 * sr), int(40 * sr)                         # bars 13-20
ff, Pxx = signal.welch(mono[a:b], sr, nperseg=8192)
print('third-octave-ish balance over bars 13-20 (dB rel. 1 kHz band):')
edges = [30, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000]
ref = None; row = []
for lo, hi in zip(edges[:-1], edges[1:]):
    p = 10 * np.log10(Pxx[(ff >= lo) & (ff < hi)].sum() + 1e-20)
    row.append((lo, hi, p))
ref = [p for lo, hi, p in row if lo == 500][0]
print('  ' + '  '.join('%d-%d: %+.0f' % (lo, hi, p - ref) for lo, hi, p in row))
print('clipped samples (>= 0.999):', int((np.abs(x) >= 0.999).sum()))
