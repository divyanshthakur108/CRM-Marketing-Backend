import json, base64, re, urllib.request, sys
env = {}
for line in open('/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/.env'):
    m = re.match(r'^\s*([A-Z_]+)\s*=\s*(.*)$', line.rstrip('\n'))
    if m: env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
KEY, MODEL = env['GEMINI_API_KEY'], env.get('GEMINI_TEXT_MODEL', 'gemini-2.5-flash')
SHOTS = [("v1",4.04,"real footage, exterior of THIS property"),("v2",3.5,"real footage, exterior of THIS property"),("v3",3.5,"real footage, exterior of THIS property"),("v4",3.0,"real footage, exterior of THIS property"),("s3",2.5,"real footage, inside the flat"),("s4",3.54,"real footage"),("s5",3.0,"real footage"),("s6b",3.0,"real footage"),("s6",3.0,"real footage"),("s7",3.5,"real footage, view from the terrace"),("end",4.6,"end card with project facts")]
FACTS = {"projectName":"TDI Wellington Heights 2","city":"Mohali","locality":"Sector 117","price":"1.35 Cr","possession":"Ready to move",
 "floors":"Lower floor of a 2-storey classical villa-style building (the exterior shots show this building)","highlights":["All cupboards and kitchen newly made with HDHMR","New paint, untouched flat","Sun-facing","Corner","Side park","4 balconies"]}
prompt = f"""You are writing a 33-second Instagram reel for an Indian real-estate listing.
You get one frame from each shot, in order (the end card has no frame). Project facts: {json.dumps(FACTS)}.
Shots (id, seconds, source): {json.dumps(SHOTS)}

For EACH shot write:
- "caption": on-screen text, 2-6 words, Hinglish in Latin script, describing what THIS frame shows (tied to a fact where it fits).
- "key": the one word in the caption to highlight.
- "voice": voiceover line in Hindi (Devanagari; common English property words like flat, kitchen, Sector may stay English in Devanagari),
  natural and warm, max {{0}} words where {{0}} = floor(seconds * 2.2). It must fit inside the shot.
Rules: describe only what is visible in the frame or listed in the facts. Never invent sizes, amenities, distances, brands or claims.
Shot v1 is the opening hook (golden-hour exterior). The end shot is a call to action using the price and location.
Return only JSON: {{"shots":[{{"id":"s1","caption":"...","key":"...","voice":"..."}}]}}"""
parts = [{"text": prompt}]
for sid, _, _ in SHOTS:
    if sid == "end": continue
    parts.append({"text": f"Frame for shot {sid}:"})
    parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(open(f"frames_villa/{sid}.jpg","rb").read()).decode()}})
body = {"contents":[{"parts":parts}], "generationConfig":{"responseMimeType":"application/json","temperature":0.6}}
req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
      data=json.dumps(body).encode(), headers={"x-goog-api-key":KEY,"Content-Type":"application/json"})
try:
    r = json.load(urllib.request.urlopen(req, timeout=180))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, json.load(e).get("error",{}).get("message","")[:300]); sys.exit(1)
text = r["candidates"][0]["content"]["parts"][0]["text"]
data = json.loads(text)
json.dump(data, open("script_villa.json","w"), ensure_ascii=False, indent=1)
print("model:", MODEL)
for s in data["shots"]: print(f'{s["id"]:4} | {s["caption"]:34} | key={s["key"]:10} | {s["voice"]}')
