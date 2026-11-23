#!/bin/bash
set -euo pipefail
source /Users/lakshaybansal/code/realestate/poc-output/lib.sh
SEG=$OUT/segments_nocap
A=/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/storage/creative-lab/assets
TOUR=$A/9f83144f-5748-426c-9bb8-d475edc9674a.mp4
ai s1 "$OUT/clips/kling1_drone.mp4" ""
real s3 "$TOUR" 2.5 2.5 ""
real s4 "$TOUR" 15 3.5 ""
real s5 "$TOUR" 29 3 ""
real s6b "$A/b9be1f2b-ccc9-4747-933b-fbb995643b1b.mp4" 10.5 3 ""
real s6 "$TOUR" 48 3 ""
real s7 "$A/f6afcff0-2cac-4c67-a8a4-2e71c6802109.mp4" 6 3.5 ""
$FF -v error -y -i "$OUT/clips/hailuo_day_to_dusk.mp4" -t 5.2 -vf "scale=1080:-2:flags=lanczos,crop=1080:1920:0:(ih-1920)*0.3,$TOPBAND,$(label s9 "" "AI visualisation of real photo"),$COMMON" "${ENC[@]}" "$SEG/s9.mp4"
cp "$OUT/segments/s8_end.mp4" "$SEG/s8.mp4"
LIST=$OUT/concat_nocap.txt; : > "$LIST"
for s in s1 s3 s4 s5 s6b s6 s7 s9 s8; do echo "file '$SEG/$s.mp4'" >> "$LIST"; done
$FF -v error -y -f concat -safe 0 -i "$LIST" -vf "fade=t=in:st=0:d=0.3,$COMMON" "${ENC[@]}" "$OUT/base_nocap.mp4"
for s in s1 s3 s4 s5 s6b s6 s7 s9 s8; do printf "%s %s\n" $s $(/opt/homebrew/opt/ffmpeg-full/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$SEG/$s.mp4"); done
