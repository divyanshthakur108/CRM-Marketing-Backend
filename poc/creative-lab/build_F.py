"""Reel F: AI Punjabi presenter intro + real villa footage + twilight + end card, luxury captions.
Usage: python3 build_F.py <presenter.mp4> <veo|sarvam> <out.mp4>"""
import json, subprocess, sys
from caption_styles import style_lux
PR, MODE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FF = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
FONT = "/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/assets/fonts/NotoSans-Regular.ttf"
PR_DUR = 10.0
# (id, duration, start inside base_E) - base_E already carries the top band and honesty labels
REAL = [("v1", 4.042), ("v2", 3.5), ("v3", 3.5), ("s3", 2.5), ("s4", 3.542), ("s5", 3.0), ("s6", 3.0), ("s7", 3.5)]
ORDER = [("pr", PR_DUR)] + REAL + [("vd", 5.0), ("end", 4.625)]
total = sum(d for _, d in ORDER)

open("text/g_pr.txt", "w").write("AI presenter (AI-generated person)")
open("text/f_note.txt", "w").write("Property shots: actual footage  •  Presenter & twilight: AI-generated")
open("captions_F_lux.ass", "w", encoding="utf-8").write(style_lux(json.load(open("script_E.json")), ORDER, "voice_villa_pa_sec"))

v = [f"[0:v]trim=0:{PR_DUR},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6,"
     "eq=contrast=1.03:saturation=1.04,"
     f"drawbox=x=64:y=1450:w=560:h=52:color=black@0.55:t=fill,drawtext=fontfile={FONT}:textfile=text/g_pr.txt:fontsize=28:fontcolor=white:x=80:y=1460,"
     "fps=24,format=yuv420p,setsar=1[p]",
     "[1:v]trim=0:26.584,setpts=PTS-STARTPTS[r]",
     "[1:v]trim=26.584:31.584,setpts=PTS-STARTPTS[d]",
     "[1:v]trim=34.584:39.208,setpts=PTS-STARTPTS[e]",
     # end card footnote: this reel mixes real footage with AI shots, so restate it honestly
     f"[e]drawbox=x=150:y=1690:w=780:h=50:color=0x0B0F17:t=fill,"
     f"drawtext=fontfile={FONT}:textfile=text/f_note.txt:fontsize=26:fontcolor=0x94A3B8:x=(w-text_w)/2:y=1700[e2]",
     "[p][r][d][e2]concat=n=4:v=1:a=0,subtitles=filename=captions_F_lux.ass[vout]"]
inputs = ["-i", PR, "-i", "base_E.mp4"]
a, n, idx = [], 0, 2
if MODE == "veo":
    a.append(f"[0:a]atrim=0:{PR_DUR},afade=t=out:st={PR_DUR-0.4}:d=0.4,aresample=48000[a{n}]"); n += 1
else:
    inputs += ["-i", "voice_presenter/pr_pa_shubh.wav"]
    a.append(f"[{idx}:a]aresample=48000,adelay=400|400[a{n}]"); idx += 1; n += 1
t = PR_DUR
for sid, dur in REAL + [("vd", 5.0), ("end", 4.625)]:
    if sid != "vd":
        inputs += ["-i", f"voice_villa_pa/{sid}.wav"]; ms = int((t + 0.15) * 1000)
        a.append(f"[{idx}:a]aresample=48000,adelay={ms}|{ms}[a{n}]"); idx += 1; n += 1
    t += dur
a.append("".join(f"[a{i}]" for i in range(n)) + f"amix=inputs={n}:duration=longest:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=7[aout]")
subprocess.run([FF, "-v", "error", "-y", *inputs, "-filter_complex", ";".join(v + a), "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-t", f"{total:.3f}", "-movflags", "+faststart", OUT], check=True)
print("built", OUT, round(total, 2), "s")
