#!/bin/bash
set -euo pipefail
source /Users/lakshaybansal/code/realestate/poc-output/lib.sh
# Hailuo clip: 1280x2848 -> 1080 wide, crop to 1920 tall keeping the upper towers in frame
$FF -v error -y -i "$OUT/clips/hailuo_day_to_dusk.mp4" -t 5.2 -vf "scale=1080:-2:flags=lanczos,crop=1080:1920:0:(ih-1920)*0.3,$TOPBAND,$(label s9_dusk "Evenings at home" "AI visualisation of real photo"),$COMMON" "${ENC[@]}" "$SEG/s9_dusk.mp4"
LIST=$OUT/concat_v2.txt; : > "$LIST"
for s in s1_drone s3_entry s4_kitchen s5_study s6b_bedroom s6_wardrobe s7_terrace s9_dusk s8_end; do echo "file '$SEG/$s.mp4'" >> "$LIST"; done
$FF -v error -y -f concat -safe 0 -i "$LIST" -vf "fade=t=in:st=0:d=0.3,$COMMON" "${ENC[@]}" -movflags +faststart "$OUT/tdi_wellington_reel_v2.mp4"
/opt/homebrew/opt/ffmpeg-full/bin/ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 "$OUT/tdi_wellington_reel_v2.mp4"
