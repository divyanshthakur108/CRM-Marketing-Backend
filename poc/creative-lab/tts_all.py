import json, re, urllib.request, base64, subprocess
env={}
for line in open('/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/.env'):
    m=re.match(r'^\s*([A-Z_]+)\s*=\s*(.*)$', line.rstrip('\n'))
    if m: env[m.group(1)]=m.group(2).strip().strip('"').strip("'")
DUR={"s1":5.0,"s3":2.5,"s4":3.542,"s5":3.0,"s6b":3.0,"s6":3.0,"s7":3.5,"s9":5.167,"end":4.625}
def tts(text, pace):
    body={"text":text,"target_language_code":"hi-IN","speaker":"shubh","model":"bulbul:v3","pace":pace}
    req=urllib.request.Request("https://api.sarvam.ai/text-to-speech",data=json.dumps(body).encode(),headers={"api-subscription-key":env["SARVAM_API_KEY"],"Content-Type":"application/json"})
    return base64.b64decode(json.load(urllib.request.urlopen(req,timeout=60))["audios"][0])
def dur(p): return float(subprocess.run(["/opt/homebrew/opt/ffmpeg-full/bin/ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",p],capture_output=True,text=True).stdout)
d=json.load(open('script.json'))
for s in d['shots']:
    limit=DUR[s['id']]-0.35; pace=1.0
    for attempt in range(4):
        p=f"voice/{s['id']}.wav"; open(p,"wb").write(tts(s['voice'],pace)); L=dur(p)
        if L<=limit: break
        pace=round(min(1.6, pace*L/limit+0.03),2)
    s['voiceSeconds']=round(L,2); s['pace']=pace
    print(f"{s['id']:4} shot {DUR[s['id']]:.2f}s  voice {L:.2f}s  pace {pace}  {'OK' if L<=limit else 'TOO LONG'}")
json.dump(d,open('script.json','w'),ensure_ascii=False,indent=1)
