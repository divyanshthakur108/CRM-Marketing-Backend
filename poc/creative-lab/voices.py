import json, re, urllib.request, base64, subprocess, sys
env={}
for line in open('/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/.env'):
    m=re.match(r'^\s*([A-Z_]+)\s*=\s*(.*)$', line.rstrip('\n'))
    if m: env[m.group(1)]=m.group(2).strip().strip('"').strip("'")
DUR={"s1":5.0,"s3":2.5,"s4":3.542,"s5":3.0,"s6b":3.0,"s6":3.0,"s7":3.5,"s9":5.167,"end":4.625}
def tts(text, lang, speaker, pace):
    body={"text":text,"target_language_code":lang,"speaker":speaker,"model":"bulbul:v3","pace":pace}
    req=urllib.request.Request("https://api.sarvam.ai/text-to-speech",data=json.dumps(body).encode(),headers={"api-subscription-key":env["SARVAM_API_KEY"],"Content-Type":"application/json"})
    try: return base64.b64decode(json.load(urllib.request.urlopen(req,timeout=60))["audios"][0])
    except urllib.error.HTTPError as e: sys.exit(f"Sarvam HTTP {e.code}: {e.read().decode()[:400]}")
def dur(p): return float(subprocess.run(["/opt/homebrew/opt/ffmpeg-full/bin/ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",p],capture_output=True,text=True).stdout)
def voice_all(script, field, lang, speaker, outdir):
    import os; os.makedirs(outdir, exist_ok=True)
    for s in script['shots']:
        limit=DUR[s['id']]-0.35; pace=1.0
        for _ in range(4):
            p=f"{outdir}/{s['id']}.wav"; open(p,"wb").write(tts(s[field],lang,speaker,pace)); L=dur(p)
            if L<=limit: break
            pace=round(min(1.6,pace*L/limit+0.03),2)
        s[f'{outdir}_sec']=round(L,2)
        print(f"  {s['id']:4} {L:.2f}s / {DUR[s['id']]:.2f}s pace {pace} {'OK' if L<=limit else 'TOO LONG'}")
if __name__=="__main__":
    mode=sys.argv[1]; d=json.load(open('script.json'))
    if mode=="female":
        print("Hindi female (ishita):"); voice_all(d,"voice","hi-IN","ishita","voice_f")
    if mode=="punjabi":
        print("Punjabi male (shubh):"); voice_all(d,"voice_pa","pa-IN","shubh","voice_pa")
    json.dump(d,open('script.json','w'),ensure_ascii=False,indent=1)
