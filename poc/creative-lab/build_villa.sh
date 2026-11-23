#!/bin/bash
set -euo pipefail
source /Users/lakshaybansal/code/realestate/poc-output/lib.sh
SEG=$OUT/segments_villa; mkdir -p "$SEG"
A=/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/storage/creative-lab/assets
real v1 "$A/3fe1e2bb-c0e5-4c88-b5eb-d1bfa8f0f3fb.mp4" 2 4 ""      # golden-hour facade walk (hook)
real v2 "$A/39e8e2ec-faa2-450e-972d-d45b3881c597.mp4" 0 3.5 ""    # low angle balconies
real v3 "$A/b8624f0b-0d3c-4977-9ac3-d32667ddb54e.mp4" 0.5 3.5 ""  # row of facades
real v4 "$A/d9ded445-fac2-453a-85f9-7f58ab31f9bd.mp4" 12 3 ""    # golden sweep along the row
# end card: all visuals real in this reel
L1=$(t ve1 "TDI WELLINGTON"); L2=$(t ve2 "HEIGHTS 2"); L3=$(t ve3 "Sector 117, Mohali")
L4=$(t ve4 "READY TO MOVE  •  ₹1.35 Cr"); L5=$(t ve5 "Sun-facing corner floor  •  4 balconies")
L6=$(t ve6 "Side park  •  New HDHMR kitchen & cupboards"); L7=$(t ve7 "New paint  •  Untouched"); L8=$(t ve8 "All visuals: actual footage of the property")
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
fade=t=in:st=0:d=0.4,$COMMON" "${ENC[@]}" "$SEG/vend.mp4"
N=$OUT/segments_nocap
LIST=$OUT/concat_villa.txt; : > "$LIST"
for f in $SEG/v1 $SEG/v2 $SEG/v3 $SEG/v4 $N/s3 $N/s4 $N/s5 $N/s6b $N/s6 $N/s7 $SEG/vend; do echo "file '$f.mp4'" >> "$LIST"; done
$FF -v error -y -f concat -safe 0 -i "$LIST" -vf "fade=t=in:st=0:d=0.3,$COMMON" "${ENC[@]}" "$OUT/base_villa.mp4"
for f in v1 v2 v3 v4 vend; do printf "%s %s\n" $f $(/opt/homebrew/opt/ffmpeg-full/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$SEG/$f.mp4"); done
/opt/homebrew/opt/ffmpeg-full/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/base_villa.mp4"
