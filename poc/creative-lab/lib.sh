#!/bin/bash
# POC: 30-second reel for TDI Wellington Heights 2
# 2 Kling AI clips (from real exterior photos) + 5 real footage shots + facts-only end card.
set -euo pipefail
FF=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
ROOT=/Users/lakshaybansal/code/realestate
ASSETS=$ROOT/CRM-Marketing-Backend/storage/creative-lab/assets
FONTS=$ROOT/CRM-Marketing-Backend/assets/fonts
OUT=$ROOT/poc-output
SEG=$OUT/segments; TXT=$OUT/text
mkdir -p "$SEG" "$TXT"
BOLD=$FONTS/NotoSans-Bold.ttf
REG=$FONTS/NotoSans-Regular.ttf
COMMON="fps=24,format=yuv420p,setsar=1"
ENC=(-an -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 24)

t() { printf '%s' "$2" > "$TXT/$1.txt"; echo "$TXT/$1.txt"; }

# Project name band at the top (below the platform's top UI zone)
NAME=$(t name "TDI WELLINGTON HEIGHTS 2")
PLACE=$(t place "Sector 117, Mohali")
TOPBAND="drawbox=x=0:y=150:w=iw:h=170:color=black@0.35:t=fill,\
drawtext=fontfile=$BOLD:textfile=$NAME:fontsize=52:fontcolor=white:x=(w-text_w)/2:y=175,\
drawtext=fontfile=$REG:textfile=$PLACE:fontsize=36:fontcolor=0xE9D5A0:x=(w-text_w)/2:y=250"

# Feature label + honesty tag in the lower third (kept above the bottom 380 px platform zone)
label() { # $1 id, $2 feature text (empty = tag only), $3 tag text
  local G=$(t "g_$1" "$3")
  if [[ -n "$2" ]]; then
    local F=$(t "f_$1" "$2")
    echo "drawtext=fontfile=$BOLD:textfile=$F:fontsize=56:fontcolor=white:borderw=3:bordercolor=black@0.6:x=64:y=1330,\
drawbox=x=64:y=1420:w=430:h=52:color=black@0.55:t=fill,\
drawtext=fontfile=$REG:textfile=$G:fontsize=28:fontcolor=white:x=80:y=1430"
  else
    echo "drawbox=x=64:y=1450:w=430:h=52:color=black@0.55:t=fill,drawtext=fontfile=$REG:textfile=$G:fontsize=28:fontcolor=white:x=80:y=1460"
  fi
}

ai() { # $1 out, $2 src, $3 feature
  $FF -v error -y -i "$2" -t 5 -vf "scale=1080:-2:flags=lanczos,crop=1080:1920:0:(ih-1920)*0.3,$TOPBAND,$(label "$1" "$3" "AI visualisation of real photo"),$COMMON" "${ENC[@]}" "$SEG/$1.mp4"
}
real() { # $1 out, $2 src, $3 start, $4 dur, $5 feature
  # 1) trim, 2) two-pass vidstab (moves the whole frame, keeps straight lines straight),
  # 3) light denoise of WhatsApp compression blocks, 4) lanczos upscale + gentle sharpen
  local TRF="$SEG/$1.trf"
  $FF -v error -y -ss "$3" -t "$4" -i "$2" -an -c:v libx264 -crf 12 -preset fast "$SEG/$1_raw.mp4"
  $FF -v error -y -i "$SEG/$1_raw.mp4" -vf "vidstabdetect=shakiness=6:accuracy=15:result=$TRF" -f null -
  $FF -v error -y -i "$SEG/$1_raw.mp4" -vf "vidstabtransform=input=$TRF:smoothing=20:optzoom=1:zoomspeed=0.2:interpol=bicubic,hqdn3d=2:1.5:4:3,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,unsharp=5:5:0.5:5:5:0,eq=contrast=1.04:saturation=1.06,$TOPBAND,$(label "$1" "$5" "Actual footage"),$COMMON" "${ENC[@]}" "$SEG/$1.mp4"
  rm -f "$SEG/$1_raw.mp4" "$TRF"
}

