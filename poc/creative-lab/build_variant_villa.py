import json, subprocess, sys, os
VOICE_DIR=sys.argv[1]; OUTFILE=sys.argv[2]; MUSIC=sys.argv[3] if len(sys.argv)>3 else None; SEC_KEY=sys.argv[4] if len(sys.argv)>4 else "voiceSeconds"
FF="/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
FONTS="/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/assets/fonts"
ORDER=[("v1",4.042),("v2",3.5),("v3",3.5),("v4",3.0),("s3",2.5),("s4",3.542),("s5",3.0),("s6b",3.0),("s6",3.0),("s7",3.5),("end",4.625)]
GOLD="&H0037AFD4&"; WHITE="&H00FFFFFF&"
d={s['id']:s for s in json.load(open('script_villa.json'))['shots']}
def ts(x):
    cs=int(round(x*100)); return f"{cs//360000}:{cs//6000%60:02d}:{cs//100%60:02d}.{cs%100:02d}"
ass=["[Script Info]","ScriptType: v4.00+","PlayResX: 1080","PlayResY: 1920","WrapStyle: 0","ScaledBorderAndShadow: yes","",
"[V4+ Styles]","Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
"Style: Cap,Noto Sans,94,&H00FFFFFF&,&H00FFFFFF&,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,760,1","",
"[Events]","Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
inputs=[]; filt=[]; t=0.0; n=0
for sid,dur in ORDER:
    s=d[sid]; vstart=t+0.15
    inputs+=["-i",f"{VOICE_DIR}/{sid}.wav"]; ms=int(vstart*1000)
    filt.append(f"[{n+1}:a]aresample=48000,adelay={ms}|{ms}[a{n}]"); n+=1
    if sid!="end":  # end card already shows the facts
        words=s['caption'].split(); vs=s[SEC_KEY]; step=int(min(260, vs*1000*0.8/max(1,len(words))))
        out=[]
        for i,w in enumerate(words):
            t0=i*step; col=GOLD if w.strip(',.').lower().startswith(s['key'].lower()) else WHITE
            out.append(f"{{\\alpha&HFF&\\fscx55\\fscy55\\1c{col}\\t({t0},{t0+1},\\alpha&H00&)\\t({t0},{t0+150},\\fscx114\\fscy114)\\t({t0+150},{t0+270},\\fscx100\\fscy100)}}{w}")
        ass.append(f"Dialogue: 0,{ts(vstart)},{ts(t+dur-0.12)},Cap,,0,0,0,,{{\\fad(0,140)}}"+" ".join(out))
    t+=dur
open(f"captions_{os.path.basename(VOICE_DIR)}.ass","w",encoding="utf-8").write("\n".join(ass)+"\n")
if MUSIC:
    inputs+=["-stream_loop","-1","-i",MUSIC]; mi=n+1
    filt.append("".join(f"[a{i}]" for i in range(n))+f"amix=inputs={n}:duration=longest:normalize=0,asplit=2[vo][sc]")
    filt.append(f"[{mi}:a]aresample=48000,atrim=0:{t:.3f},volume=0.55,afade=t=in:d=0.8,afade=t=out:st={t-2.0:.3f}:d=2[mus]")
    filt.append("[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]")
    filt.append("[vo][duck]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=9[aout]")
else:
    filt.append("".join(f"[a{i}]" for i in range(n))+f"amix=inputs={n}:duration=longest:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=7[aout]")
cmd=[FF,"-v","error","-y","-i","base_villa.mp4",*inputs,"-filter_complex",";".join(filt)+f";[0:v]subtitles=filename=captions_{os.path.basename(VOICE_DIR)}.ass:fontsdir={FONTS}[vout]",
     "-map","[vout]","-map","[aout]","-c:v","libx264","-preset","medium","-crf","17","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-t",f"{t:.3f}","-movflags","+faststart",OUTFILE]
subprocess.run(cmd,check=True); print("built, total", round(t,2), "s")
