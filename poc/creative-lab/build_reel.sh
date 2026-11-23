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
label() { # $1 id, $2 feature text, $3 tag text
  local F=$(t "f_$1" "$2") G=$(t "g_$1" "$3")
  echo "drawtext=fontfile=$BOLD:textfile=$F:fontsize=56:fontcolor=white:borderw=3:bordercolor=black@0.6:x=64:y=1330,\
drawbox=x=64:y=1420:w=430:h=52:color=black@0.55:t=fill,\
drawtext=fontfile=$REG:textfile=$G:fontsize=28:fontcolor=white:x=80:y=1430"
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

STEP=${1:-all}
if [[ "$STEP" == "real" || "$STEP" == "all" ]]; then
  TOUR=$ASSETS/9f83144f-5748-426c-9bb8-d475edc9674a.mp4
  TERRACE=$ASSETS/f6afcff0-2cac-4c67-a8a4-2e71c6802109.mp4
  real s3_entry   "$TOUR"    2.5 2.5 "Welcome home"
  real s4_kitchen "$TOUR"    15  3.5 "New modular kitchen"
  real s5_study   "$TOUR"    29  3   "Study with accent wall"
  real s6_wardrobe "$TOUR"   48  3   "Lit wardrobe & vanity"
  real s7_terrace "$TERRACE" 6   3.5 "Open terrace views"

  # End card: only facts from the project information
  L1=$(t e1 "TDI WELLINGTON"); L2=$(t e2 "HEIGHTS 2"); L3=$(t e3 "Sector 117, Mohali")
  L4=$(t e4 "READY TO MOVE  •  ₹1.35 Cr"); L5=$(t e5 "Sun-facing corner flat  •  4 balconies")
  L6=$(t e6 "Side park  •  New HDHMR kitchen & cupboards"); L7=$(t e7 "New paint  •  Untouched flat")
  L8=$(t e8 "Exterior shots: AI animation of real project photos")
  $FF -v error -y -f lavfi -i "color=c=0x0B0F17:s=1080x1920:r=24:d=4.6" -vf "\
drawbox=x=60:y=120:w=960:h=1680:color=0xD4AF37@0.8:t=2,\
drawtext=fontfile=$BOLD:textfile=$L1:fontsize=80:fontcolor=white:x=(w-text_w)/2:y=560,\
drawtext=fontfile=$BOLD:textfile=$L2:fontsize=80:fontcolor=white:x=(w-text_w)/2:y=660,\
drawtext=fontfile=$REG:textfile=$L3:fontsize=46:fontcolor=0xE9D5A0:x=(w-text_w)/2:y=790,\
drawbox=x=440:y=880:w=200:h=3:color=0xD4AF37:t=fill,\
drawtext=fontfile=$BOLD:textfile=$L4:fontsize=52:fontcolor=white:x=(w-text_w)/2:y=930,\
drawtext=fontfile=$REG:textfile=$L5:fontsize=38:fontcolor=0xE2E8F0:x=(w-text_w)/2:y=1040,\
drawtext=fontfile=$REG:textfile=$L6:fontsize=38:fontcolor=0xE2E8F0:x=(w-text_w)/2:y=1100,\
drawtext=fontfile=$REG:textfile=$L7:fontsize=38:fontcolor=0xE2E8F0:x=(w-text_w)/2:y=1160,\
drawtext=fontfile=$REG:textfile=$L8:fontsize=26:fontcolor=0x94A3B8:x=(w-text_w)/2:y=1700,\
fade=t=in:st=0:d=0.4,$COMMON" "${ENC[@]}" "$SEG/s8_end.mp4"
fi

if [[ "$STEP" == "ai" || "$STEP" == "all" ]]; then
  ai s1_drone     "$OUT/clips/kling1_drone.mp4"     "Your new address"
  ai s2_courtyard "$OUT/clips/kling2_courtyard.mp4" "Green courtyard living"
fi

if [[ "$STEP" == "join" || "$STEP" == "all" ]]; then
  LIST=$OUT/concat.txt; : > "$LIST"
  for s in s1_drone s2_courtyard s3_entry s4_kitchen s5_study s6_wardrobe s7_terrace s8_end; do
    echo "file '$SEG/$s.mp4'" >> "$LIST"
  done
  $FF -v error -y -f concat -safe 0 -i "$LIST" -vf "fade=t=in:st=0:d=0.3,$COMMON" "${ENC[@]}" -movflags +faststart "$OUT/tdi_wellington_30s_reel.mp4"
  /opt/homebrew/opt/ffmpeg-full/bin/ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 "$OUT/tdi_wellington_30s_reel.mp4"
fi
