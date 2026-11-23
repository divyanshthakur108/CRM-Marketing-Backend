import json, re, urllib.request, base64, sys
env={}
for line in open('/Users/lakshaybansal/code/realestate/CRM-Marketing-Backend/.env'):
    m=re.match(r'^\s*([A-Z_]+)\s*=\s*(.*)$', line.rstrip('\n'))
    if m: env[m.group(1)]=m.group(2).strip().strip('"').strip("'")
body={"text":"टीडीआई वेलिंगटन हाइट्स २ मोहाली में आपका स्वागत है।","target_language_code":"hi-IN","speaker":sys.argv[1],"model":sys.argv[2]}
req=urllib.request.Request("https://api.sarvam.ai/text-to-speech",data=json.dumps(body).encode(),headers={"api-subscription-key":env["SARVAM_API_KEY"],"Content-Type":"application/json"})
try:
    r=json.load(urllib.request.urlopen(req,timeout=60))
except urllib.error.HTTPError as e:
    print("HTTP",e.code,e.read().decode()[:400]); sys.exit(1)
open(f"tts_test_{sys.argv[1]}.wav","wb").write(base64.b64decode(r["audios"][0])); print("ok", sys.argv[1], sys.argv[2], list(r.keys()))
