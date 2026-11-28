#!/bin/bash
# Concatenate the lossless chunks and encode the deliverables.
#   assemble.sh <crf> <out.mp4> [extra video filters, e.g. "scale=1280:720:flags=lanczos"]
set -euo pipefail
F="$(cd "$(dirname "$0")/.." && pwd)"
CRF="${1:-17}"; OUT="${2:-$F/out/SWIRL-demo-1080p60.mp4}"; EXTRA="${3:-}"
VF="scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p"
if [ -n "$EXTRA" ]; then VF="$EXTRA,$VF"; fi
ffmpeg -y -hide_banner -loglevel error -nostats -f concat -safe 0 -r 60 -i "$F/out/shots/list.txt" -i "$F/audio/mix.wav" \
  -vf "$VF" -c:v libx264 -preset "${PRESET:-slow}" -crf "$CRF" -profile:v high -g 120 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart \
  -metadata title="SWIRL — 声音，看得见。" -metadata comment="swirl.ilililab.de" "$OUT"
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt,color_space,sample_rate,channels -of default=nw=1 "$OUT"
