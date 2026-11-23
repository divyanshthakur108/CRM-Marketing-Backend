import json, re, urllib.request, sys, voices
voices.DUR={"v1":4.04,"v2":3.5,"v3":3.5,"v4":3.0,"s3":2.5,"s4":3.542,"s5":3.0,"s6b":3.0,"s6":3.0,"s7":3.5,"end":4.625}
d=json.load(open('script_villa.json'))
env=voices.env
lines={s['id']:s['voice'] for s in d['shots']}
prompt=("Translate these Hindi voiceover lines for an Instagram real-estate reel into natural, warm spoken Punjabi (Gurmukhi script), as a Mohali property agent would say them. "
 "Keep every fact exactly (TDI Wellington Heights 2, Sector 117, 1.35 crore, 4 balconies, HDHMR); add nothing new; same length or shorter. Return only JSON with the same ids.\n\n"+json.dumps(lines,ensure_ascii=False))
body={"contents":[{"parts":[{"text":prompt}]}],"generationConfig":{"responseMimeType":"application/json","temperature":0.3}}
req=urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{env.get('GEMINI_TEXT_MODEL')}:generateContent",data=json.dumps(body).encode(),headers={"x-goog-api-key":env["GEMINI_API_KEY"],"Content-Type":"application/json"})
pa=json.loads(json.load(urllib.request.urlopen(req,timeout=120))["candidates"][0]["content"]["parts"][0]["text"])
for s in d['shots']: s['voice_pa']=pa[s['id']]
print("Hindi male:"); voices.voice_all(d,"voice","hi-IN","shubh","voice_villa_hi")
print("Punjabi male:"); voices.voice_all(d,"voice_pa","pa-IN","shubh","voice_villa_pa")
json.dump(d,open('script_villa.json','w'),ensure_ascii=False,indent=1)
for s in d['shots']: print(s['id'], '|', s['voice_pa'])
