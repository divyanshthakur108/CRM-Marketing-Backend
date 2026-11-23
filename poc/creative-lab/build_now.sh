#!/bin/bash
set -euo pipefail
source /Users/lakshaybansal/code/realestate/poc-output/lib.sh
ASSETS=/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/storage/creative-lab/assets
ai s1_drone "$OUT/clips/kling1_drone.mp4" "Your new address"
real s6b_bedroom "$ASSETS/b9be1f2b-ccc9-4747-933b-fbb995643b1b.mp4" 10.5 3 "Wardrobe & ensuite bath"
real s7b_window  "$ASSETS/289e99da-0c7e-4742-89cb-420662c69223.mp4" 3 2 "Arched window light"
LIST=$OUT/concat_v1.txt; : > "$LIST"
for s in s1_drone s3_entry s4_kitchen s5_study s6b_bedroom s6_wardrobe s7_terrace s7b_window s8_end; do echo "file '$SEG/$s.mp4'" >> "$LIST"; done
$FF -v error -y -f concat -safe 0 -i "$LIST" -vf "fade=t=in:st=0:d=0.3,$COMMON" "${ENC[@]}" -movflags +faststart "$OUT/tdi_wellington_30s_reel_v1.mp4"
/opt/homebrew/opt/ffmpeg-full/bin/ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 "$OUT/tdi_wellington_30s_reel_v1.mp4"
