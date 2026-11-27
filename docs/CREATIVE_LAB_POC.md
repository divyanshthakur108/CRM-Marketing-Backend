# Creative Lab POC: what we built and learned

> New here? Read [`CREATIVE_LAB_HANDOVER.md`](CREATIVE_LAB_HANDOVER.md) first (one-page overview, setup and plan). This file is the detailed history.

Status as of 2026-11-26 (sections 8–9: step-by-step process and API plan; section 10: progress and next steps). Test project: **TDI Wellington Heights 2** (Sector 117, Mohali, ₹1.35 Cr, ready to move).

**Goal:** RealCRM makes real-estate marketing content from what a builder uploads. The target is 4–5 reels and 6–7 posts per project per month, made as cheaply as possible.

> **Reading order for a new engineer or AI assistant**
> 1. This file: "New developer setup" below, the box after it and section 10 (progress + plan).
> 2. [`REFERENCE_REELS.md`](REFERENCE_REELS.md): 5 reference reels (GDPL, Mohali) that define the finished look we want, with shot-by-shot notes, caption animations and a combined style guide.
> 3. [`IDEA_LIBRARY.md`](IDEA_LIBRARY.md) for reel ideas; [`../poc/creative-lab/README.md`](../poc/creative-lab/README.md) for the scripts.
> 4. Code: backend `src/modules/creativelab/`, frontend `src/pages/AdminCreativeLabPage.tsx`. Branch `feature/creative-lab-poc-lakshay` in both repos.

## New developer setup (Creative Lab)

Things that are **not in git** and must be set up on each machine. The Creative Lab page shows a **"Setup" checklist** (top of the left column, from `GET /admin/creative-lab/setup`) that turns amber and prints the fix command when something is missing.

| # | What | How | Needed for | If missing |
|---|---|---|---|---|
| 1 | Both repos side by side | `realestate/CRM-Marketing-Backend` and `realestate/CRM-Marketing-Frontend`, branch `feature/creative-lab-poc-lakshay` | everything | — |
| 2 | Backend `.env` | copy `.env.example`; ask the team for the shared values: `MONGODB_URI` (shared Atlas cluster, so everyone sees the same test projects), `CLOUDINARY_*` (shared files), `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. `CREATIVE_LAB_DB` defaults to `realcrm_creative_lab`. **Never commit `.env`** | everything | local DB = you won't see the team's projects/results |
| 3 | ffmpeg with vidstab + libass | macOS: `brew install ffmpeg-full`, then `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` in `.env`. (Or `MEDIA_TOOLS=docker` for the media-tools container, but Real-ESRGAN won't run inside it) | stabilise, deflicker, captions, all video | video features fail |
| 4 | **Real-ESRGAN** AI upscaler | `cd CRM-Marketing-Backend && npm run setup:realesrgan` → downloads the official release (v0.2.5.0, ~50 MB, macOS / Linux / Windows) into `realestate/tools/realesrgan/` (outside git). Other folder: set `REALESRGAN_PATH`. Needs a Vulkan-capable GPU (Apple Silicon is fine) | clean-up sharpness | clean-up still works, but only enlarges (not sharper) |
| 5 | Gemini free limits | free tier ≈ 20 requests/day per model; image generation = 0 without billing | knowledge cards, clean-up AI check, "Gemini (paid)" map card | clean-up falls back to measured fixes; map card: use "Generate (free)" |
| 6 | Run | backend: `PORT=5050 npm run dev` (port 5000 is taken by macOS AirPlay); frontend: `API_PROXY_TARGET=http://127.0.0.1:5050 npm run dev` | — | a 403 at login means the frontend is talking to AirPlay on 5000 |
| 7 | Open | http://localhost:5173/admin/creative-lab, signed in as the platform admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, seed with `npm run seed:admin`) | — | — |

Where the work lives: code in the two repos; uploaded files, cleaned files, map cards and finished reels in **Cloudinary**; records in the **shared MongoDB** (`realcrm_creative_lab`). So anything one developer makes on the page is visible to all, as long as they use the shared `.env` values. The hand-made POC reels and scripts' outputs stay in `realestate/poc-output/` (not in git; the ones worth sharing were published to the page with `npm run creative-lab:publish`).

> **Read this first: how the POC was actually run**
>
> | Part | Runs in the product? | How it was done |
> |---|---|---|
> | Creative Lab page: project info, upload, Gemini knowledge cards | ✅ Yes, real backend + frontend code (branch `feature/creative-lab-poc-lakshay`, pushed) | Gemini API from the backend |
> | Reel building: shot clean-up, captions, Sarvam voice, render | ❌ No, local scripts in `realestate/poc-output/` | Run by hand from the terminal (Python + ffmpeg); Gemini and Sarvam called by API |
> | **AI shots** (twilight, drone, presenter image, presenter video) | ❌ No | **Made on the websites**, not by API: **Claude Code drove the user's own Chrome through the Claude in Chrome extension** on the Gemini web app (Nano Banana image edit, Veo "Create video"), Kling and Hailuo. The user signed in to each site; Claude uploaded the frame, set portrait, typed the prompt, waited, checked and downloaded the result; the user moved the files from `~/Downloads` into `poc-output/clips/` |
>
> So the quality we saw is **proven**, but the **automation is not**: nothing in the app can make an AI shot yet. Section 9 is the plan to do it through APIs; section 10 is the order we'll do things in.

---

## 1. Summary

| Step | Status |
|---|---|
| Upload photos/videos → AI "knowledge cards" | ✅ Working (Creative Lab page) |
| Real footage → stabilised, captioned 30–45 s reel | ✅ Working (ffmpeg scripts) |
| Captions written from the actual video frames (Gemini) | ✅ Working |
| Voiceover in Hindi (male/female) and Punjabi (Sarvam) | ✅ Working |
| Animated captions (6 styles, incl. Pinterest-style "luxury") | ✅ Working |
| AI shots: twilight / day→dusk, drone | ✅ Working (manual, via websites) |
| AI Punjabi presenter ("Sardar ji") speaking Punjabi | ✅ 1 clip done; 2 more blocked by Veo daily limit |
| Same presenter voice for the whole reel | ⏳ Pending (more Veo clips, or voice conversion) |
| Finished reels shared with the team (Cloudinary + "Generated results" on the page) | ✅ 4 reels (see section 4) |
| Reference study: what "neat and clean" means | ✅ 5 reference reels studied, see [`REFERENCE_REELS.md`](REFERENCE_REELS.md) |
| Brand kit (logo upload) + nearby places + map card on the page | ✅ Built 2026-11-26 (see "Brand & location" below) |
| Clean-up / improve uploads before use (step 1) | ✅ Built 2026-11-26: safe fixes + before/after + approve on the page; AI clutter removal not yet |
| Reference-style finishing (speech-synced subtitles, one grade, map card, logo) | ⏳ Not started (section 10, step 2) |
| Background music | ❌ Blocked (no free generator produced audio) |
| Automated in the app (API, no manual website steps) | ❌ Not yet: every AI shot today is made by hand on a website |

---

## Architecture

### Components
```
┌──────────────────────────────┐        ┌───────────────────────────────────────────────┐
│ Frontend (React + Vite)      │  HTTPS │ Backend (Node + Express + TypeScript)         │
│ /admin/creative-lab          │───────▶│ /api/v1/admin/creative-lab  (admin only)      │
│  • project info form         │        │                                               │
│  • drag & drop upload        │◀───────│  routes.ts   multer (memory, size limit)      │
│  • knowledge cards (polling) │  JSON  │  service.ts  upload · queue · analysis        │
└──────────────────────────────┘        │  knowledge.ts prompts + cleaners (validation) │
                                        └───┬───────────┬──────────────┬────────────────┘
                                            │           │              │
                                            ▼           ▼              ▼
                                ┌────────────────┐ ┌───────────┐ ┌───────────────────────┐
                                │ File storage   │ │ ffmpeg /  │ │ Gemini LLM            │
                                │ storage/       │ │ sharp     │ │ getAIProvider()       │
                                │ creative-lab/  │ │ (resize,  │ │ .generateJson()       │
                                │ assets/<uuid>  │ │ preview,  │ │ GEMINI_TEXT_MODEL     │
                                └────────────────┘ │ scene cut)│ │ photo / video inline  │
                                                   └───────────┘ └───────────────────────┘
                                            │
                                            ▼
                                ┌──────────────────────────────────────────┐
                                │ MongoDB (Atlas), separate DB             │
                                │ CREATIVE_LAB_DB = realcrm_creative_lab   │
                                │  • CreativeLabProject (info, brief)      │
                                │  • CreativeLabAsset   (file + knowledge) │
                                └──────────────────────────────────────────┘

        Later (POC scripts today, poc-output/):
        knowledge cards ─▶ shot picker ─▶ AI video (Veo / Kling / MiniMax) ─▶ Sarvam voice ─▶ ffmpeg render ─▶ reel
```

### Flow 1: project info → brief (facts)
```
Admin types project info
   │  POST /projects  or  PUT /projects/:id
   ▼
service.createProject / updateInfo ── saves infoText, briefStatus = PENDING
   │
   ▼
Gemini (1 call): buildBriefPrompt(infoText)
   │  returns JSON: name, location, price, status, highlights, cautions
   ▼
cleanBrief() validates and trims → project.brief, briefStatus = DONE (or FAILED + briefError)
```
The brief is the **only source of facts**. Later steps (captions, voice, end card) may not claim anything that isn't in it. The prompt also notes that project info does **not** prove where a photo was taken.

### Flow 2: upload a creative → Gemini analysis → knowledge card
```
Admin drops a photo / video
   │  POST /projects/:id/assets  (multipart, held in memory)
   ▼
1. Validate      file signature (real JPG/PNG/MP4…, not just the extension), size limit
2. Fingerprint   SHA-256 of the bytes
3. Store         storage/creative-lab/assets/<uuid>.<ext>  + small preview thumbnail
4. Twin check    same hash already analysed in this project? → reuse its card (no LLM call)
5. Save asset    CreativeLabAsset { status: QUEUED }
6. Queue         analysisChain (in-process, one file at a time, so free-tier limits are respected)
   │
   ▼  worker: analyzeOne(assetId)   status → ANALYZING
   │
   ├─ PHOTO ────────────────────────────────────────────────────────────────┐
   │   sharp: rotate upright, resize long side ≤ 1600 px                     │
   │   Gemini (1 call): photo + buildImagePrompt(brief, info)                │
   │   cleanImageKnowledge(): space type, source type, what it shows,        │
   │     quality issues, best use, idea tags (from the IDEA_TAGS list)       │
   │                                                                         │
   ├─ VIDEO ────────────────────────────────────────────────────────────────┤
   │   ffprobe: duration, size, has audio                                    │
   │   ffmpeg: small preview copy (640 px, 5 fps, mono audio)                │
   │   ffmpeg: scene detection → exact hard cuts                             │
   │   Gemini (1 call): preview video + buildVideoPrompt(cuts, brief, info)  │
   │     (Gemini watches and listens to the clip)                            │
   │   cleanVideoKnowledge(): shot list snapped to the real cuts,            │
   │     each shot: space, camera move, quality, idea tags;                  │
   │     transcript (if speech), overall summary                             │
   │   ffmpeg: one thumbnail per shot                                        │
   │                                                                         │
   ▼─────────────────────────────────────────────────────────────────────────┘
asset.knowledge = card, aiModel, steps (timings), analysisMs, status → DONE
(on error: status → FAILED + error; a stuck ANALYZING > 20 min is marked stale)
   │
   ▼
Frontend polls GET /projects/:id every few seconds → shows the card
"Re-analyse" → POST /assets/:id/reanalyze (forces a fresh Gemini call)
```

### Why it's built this way
- **Gemini output is never trusted raw.** Every response goes through a `clean*()` function that checks types, allowed values (spaces, idea tags, quality issues) and time ranges, so a bad answer can't break the UI or a later step.
- **One file at a time**, to stay inside the free Gemini quota (about 20 calls/day). A real queue such as BullMQ replaces this in production.
- **Small previews** (1600 px photos, 640 px / 5 fps videos) keep each call small and cheap. Real scene cuts from ffmpeg keep shot timings exact, because the LLM only labels them.
- **Separate database** for the lab, and delete removes records only, never files, so test data can't touch real organisations.
- **Knowledge cards are the input for generation.** The shot picker, caption writer and AI-shot prompts (sections 8–9) all read from these cards and the brief, not from the raw files.

---

## 2. Creative Lab test page

Admin only: **`/admin/creative-lab`**. There is also a "Creative Lab" button on the Admin Organizations page.

- Type the project info → Gemini extracts **facts** (price, location, highlights) into a brief.
- Upload photos/videos. Each one is analysed into a **knowledge card**:
  - **Photos:** space type, quality issues, what it shows, idea tags.
  - **Videos:** scene cuts, shot list with thumbnails, transcript, idea tags.
- Uses a **separate database** (`CREATIVE_LAB_DB`, default `realcrm_creative_lab`), never mixed with the main data.
- Delete removes **database records only**. Uploaded files stay in storage.
- Current data: 1 project, 27 assets (11 photos, 7 interior/terrace videos, 9 villa exterior videos).

Code (branch `feature/creative-lab-poc` in both repos, **not committed yet**):

| Repo | Files |
|---|---|
| Backend | `src/modules/creativelab/{model,knowledge,service,routes}.ts`, mounted in `src/app.ts` at `/api/v1/admin/creative-lab`; `tests/creativelab_knowledge.test.ts` (8 passing); `docs/IDEA_LIBRARY.md` |
| Frontend | `src/pages/AdminCreativeLabPage.tsx`, route in `src/App.tsx`, button in `AdminOrganizationsPage.tsx` |

Run locally on macOS: the backend runs on port 5050 because AirPlay uses 5000. Start the frontend with `API_PROXY_TARGET=http://127.0.0.1:5050 npm run dev`.

---

## 3. Video pipeline (POC scripts)

Folder: `realestate/poc-output/` on the developer machine (scripts + outputs, ~750 MB, not in git). **A copy of the scripts is in this repo at `poc/creative-lab/`** (see its README).

```
knowledge cards → pick best real shots → trim + stabilise (vidstab 2-pass, denoise, sharpen)
  → Gemini writes captions from the actual frames (facts checked against the brief)
  → Sarvam voice per shot, pace fitted to shot length
  → animated ASS captions (libass) + honesty labels + facts-only end card
  → ffmpeg join, loudness normalised
```

| Script | What it does |
|---|---|
| `lib.sh` | Shared helpers: top name band, labels ("Actual footage" / "AI visualisation"), real-shot clean-up |
| `build_villa.sh` | Villa segments + end card |
| `script_from_frames.py`, `script_villa.py` | Gemini captions/voice lines from real frames |
| `voices.py`, `voices_villa.py` | Sarvam TTS (`bulbul:v3`, `hi-IN` / `pa-IN`, speakers `shubh` / `ishita`) |
| `captions.py` | Caption styles: pop, highlight (karaoke), stack |
| `caption_styles.py` | Caption styles: chunks (gold box), slide-up, typewriter, **lux** (Pinterest reference) |
| `build_E.py` | Reel E: real villa + AI twilight, Hindi |
| `build_F.py` | Reel F: AI presenter + real footage + twilight, Punjabi, lux captions |

Rules every reel follows:
- **Facts only from the brief.** No invented prices, sizes or amenities.
- **Every shot is labelled**: "Actual footage", "AI visualisation of real photo" or "AI presenter (AI-generated person)".
- **AI may change light, weather or camera only. It must never redraw the building.**

---

## 4. Outputs (in `poc-output/`)

**Shared with the team:** the ✅ reels below (F Veo voice, F Sarvam voice, villa Punjabi, villa Hindi) are uploaded to Cloudinary and listed on the Creative Lab page under **4. Generated results** for the test project, so every admin sees them (records are in the lab database, collection `creativelabresults`). To add or change one, edit `poc/creative-lab/results.json` and run `npm run creative-lab:publish` (add `-- --dry-run` to check first). Running it again only updates titles and notes. API: `POST /admin/creative-lab/projects/:id/results` (MP4 upload with title, notes, aiDisclosure, tags, verdict) and `DELETE /admin/creative-lab/results/:id` (removes the record, keeps the file).

| File | What | Use? |
|---|---|---|
| `tdi_villa_reel_hindi.mp4`, `tdi_villa_reel_punjabi.mp4` | 37 s, all real villa + interiors | ✅ |
| `tdi_villa_reel_E_cinematic_hindi.mp4` | 39 s, real + AI twilight | ⚠️ end card wrongly says "All visuals: actual footage", fix before sharing |
| `tdi_villa_E_captions_{chunks,slide,type,lux}.mp4` | Same reel E, 4 caption styles | ⚠️ same end-card issue |
| `tdi_villa_reel_F_presenter_veo_voice.mp4` | 46 s, Sardar ji intro (Veo voice) + Punjabi voiceover | ✅ preferred intro |
| `tdi_villa_reel_F_presenter_sarvam_voice.mp4` | Same, intro voiced by Sarvam | Lips don't match |
| `tdi_wellington_*`, `tdi_reel_*` | Early reels using tower photos | ❌ Misleading: the towers are not this property |

AI clips in `poc-output/clips/`:

| Clip | Tool | Use? |
|---|---|---|
| `veo_villa_twilight.mp4` | Gemini Veo | ✅ building unchanged, only the light changes |
| `veo_presenter_pa.mp4` + `presenter_still.png` | Gemini image edit + Veo | ✅ AI presenter, building unchanged |
| `veo_villa_drone.mp4` | Gemini Veo | ⚠️ invents roofs and surroundings; only with an "AI visualisation" label |
| Crane shot (not kept) | Gemini Veo | ❌ redrew the villa |
| `kling1_drone.mp4`, `hailuo_day_to_dusk.mp4` | Kling / Hailuo websites | Tower photos only, not this property |

---

## 5. AI tools tried

| Tool | Result | Cost / limit |
|---|---|---|
| **Gemini app (Pro): Nano Banana image edit + Veo video** | Best quality. Portrait 720×1280, 10 s, audio with lip sync | Included in Pro; about 4–5 videos/day, then errors |
| Hailuo (website) | Excellent start→end frame (day→dusk) | 80 free credits; 60 per clip |
| Kling (website) | Good drone motion, watermark | 66 free credits/day; the API needs a paid resource pack |
| Google Colab + LTX-Video | Works on a free T4 but low quality | Free |
| Gemini API image/video | Free-tier limit is 0 | Paid only |
| Gemini "Create music" | Gave no audio | n/a |
| Sarvam TTS | Good Hindi and Punjabi | Paid API key |

---

## 6. Caption styles

| Style | Look |
|---|---|
| Pop | Words pop in one by one; key word in gold |
| Highlight | Karaoke: words turn gold as they're spoken |
| Stack | 1–2 big words per line slide in from the left |
| Chunks | 1–2 big uppercase words centred; key phrase in a gold box |
| Slide | Lines slide up from behind a mask |
| Typewriter | Letters type out with a blinking cursor |
| **Lux** (chosen) | Thin, wide-spaced uppercase in two short lines; blur-in while the letters spread; soft shade behind for white walls. Rebuilt from a Pinterest reference, not copied |

---

## 7. Open problems (the full ordered plan is in section 10)

1. **One presenter voice for the whole reel.** Veo voices only its own 10 s clip, and the rest uses Sarvam, which sounds like a different man.
   - Next: make Veo clips 2 and 3 (features; price + call to action) once the daily limit resets.
   - Longer term: voice conversion on Colab (Sarvam Punjabi → Sardar ji's voice) so it isn't tied to Veo's limits.
2. **Fix the end-card footnote** on reel E and its caption versions. Reel F already says "Property shots: actual footage • Presenter & twilight: AI-generated".
3. **Music:** pick a free licensed track (e.g. Pixabay) or a synth bed. `build_variant.py` already supports music with voice ducking.
4. **Automate:** move the steps from manual websites to APIs (paid Veo/Kling) or self-hosted models, and add a "Generated videos" section to the Creative Lab.
5. **Commit** both `feature/creative-lab-poc` branches when ready.
6. **Security:** the Kling and Sarvam API keys were shared in chat. **Rotate them.** They are only in the git-ignored `.env`.

Manual workflow today: AI websites download to `~/Downloads`, which tools here can't read, so files are moved by hand into `poc-output/clips/`. Setting Chrome's download folder to `poc-output/clips/` removes that step.

---

## 8. Step-by-step: how each piece was made (manual POC)

### 8.1 Understanding uploads (already through APIs)
1. Admin types the project info → `POST /api/v1/admin/creative-lab/projects` → **1 Gemini call** extracts the brief (facts, highlights, cautions).
2. Admin uploads files → `POST /projects/:id/assets`. The server checks the file signature and SHA-256 hash, stores the file and makes a preview thumbnail. A same-project duplicate reuses the earlier analysis.
3. A background queue analyses each file:
   - **Photo:** rotate, resize to 1600 px → 1 Gemini call → image knowledge card.
   - **Video:** 640 px / 5 fps preview + ffmpeg scene cuts → 1 Gemini call → shot list (snapped to cuts), transcript, idea tags, shot thumbnails.
4. The UI polls and shows the cards. "Re-analyse" forces a fresh call.

### 8.2 Real-footage reel (local scripts)
1. **Pick shots:** read the knowledge cards and choose the best real shots (villa exterior, entry, kitchen, study, wardrobe, terrace). A person chose them for the POC; the planner will do it later.
2. **Clean each shot** (`lib.sh real`):
   - trim;
   - two-pass `vidstabdetect`/`vidstabtransform`. `deshake` was replaced because it tore the picture;
   - `hqdn3d` denoise for WhatsApp compression;
   - lanczos scale to 1080×1920, `unsharp`, slight colour lift;
   - top name band + "Actual footage" label.
3. **Write captions from the frames** (`script_from_frames.py` / `script_villa.py`): send 1 middle frame per shot plus the brief to Gemini. It returns a short caption, a key word and Hindi/Punjabi voice lines. Any claim not in the brief is rejected.
4. **Voice** (`voices.py`): Sarvam TTS per shot. If a line is longer than its shot, it is regenerated with a higher `pace` until it fits. The real length is saved (`voice_*_sec`) so captions can follow it.
5. **Captions** (`captions.py` / `caption_styles.py`): build an ASS subtitle file with animation tags (`\t` scale pop, `\kf` karaoke, `\move`, `\clip`, `\fsp` spread, `\blur`).
6. **Assemble** (`build_E.py` / `build_F.py`): concat segments, burn captions with libass, place each voice with `adelay`, `amix`, then `loudnorm` to −15 LUFS. Optional music is ducked under the voice with `sidechaincompress`.
7. **End card:** facts only (name, sector, price, ready to move, highlights) plus a footnote that honestly says which shots are AI.

### 8.3 AI shots (manual, on websites)
| Shot | Input | Tool + steps | Result |
|---|---|---|---|
| Twilight | Best villa frame (`villa_golden.jpg`, taken from a real video) | Gemini app → Create video, portrait, prompt: same building, light goes from golden hour to twilight, windows glow, camera nearly still | ✅ kept |
| Crane | Same frame | Veo, camera rises up the facade | ❌ redrew the villa |
| Drone | Same frame | Veo, prompt: start at street level, rise and tilt down over the row of villas, keep the buildings identical, no people/cars/text | ⚠️ invents the roofs |
| Presenter still | Same frame | Gemini image edit: add a **fictional** Punjabi Sikh man, early 30s, navy turban, grey blazer, waist-up, gesturing to the villa, same sunset light, building unchanged | ✅ `presenter_still.png` |
| Presenter talking | Presenter still | Veo, portrait: he smiles, gestures, steps forward and says in Punjabi "Sat Sri Akal ji! Mohali, Sector 117 vich eh ghar, bilkul ready to move. Aao, tuhanu andar dikhaunde haan!"; natural lip sync; building unchanged; no music/text | ✅ 10 s, own voice |
| Presenter clips 2–3 | Presenter still / last frame of clip 1 | Veo, features line and price + call-to-action line | ❌ daily limit reached |

Manual steps around each website: sign in (done by the user) → upload the frame → set portrait → type the prompt → wait 2–4 min (press "Try again" on errors) → download → move from `~/Downloads` to `poc-output/clips/` → check frames that the building is unchanged.

### 8.4 Reel F (presenter reel)
`python3 build_F.py clips/veo_presenter_pa.mp4 veo out.mp4`:
- presenter clip scaled to 1080×1920 with its Veo audio + "AI presenter (AI-generated person)" tag;
- real villa and interior shots from reel E;
- 5 s of twilight;
- end card with a corrected footnote;
- Punjabi Sarvam voice per shot;
- lux captions, placed above his head on the presenter shot.

---

## 9. Doing the same through APIs (automation plan)

Every manual step above has an API or a server-side equivalent. Steps marked **(verify)** need a quick check of the provider's current docs and pricing before building.

| Step | Today | Through API / server |
|---|---|---|
| Brief + knowledge cards | ✅ Gemini API | Already in the backend (`creativelab/service.ts`) |
| Shot cleanup, captions, voice mix, render | Local scripts | Same ffmpeg commands in the `media-tools` Docker container; scripts become a `render` job |
| Captions from frames | Gemini API (script) | Move into the backend: `POST /projects/:id/reels/script` |
| Voice | ✅ Sarvam REST `POST https://api.sarvam.ai/text-to-speech` | Already an API: `api-subscription-key` header, `bulbul:v3`, `hi-IN`/`pa-IN`, base64 WAV |
| Presenter still (image edit) | Gemini app (Nano Banana) | Gemini API image model with an input image + edit prompt **(verify model name; the free-tier limit was 0, so it needs a paid key)** |
| Twilight / drone / presenter video | Gemini app (Veo) | Veo through the Gemini API or Vertex AI: image-to-video, 9:16, async operation polled until done, returns MP4 with audio **(verify model, price per second)** |
| Day→dusk (start + end frame) | Hailuo website | MiniMax (Hailuo) video API with first + last frame **(verify)** |
| Drone motion alternative | Kling website | Kling API: `Authorization: Bearer <key>`, base `https://api-singapore.klingai.com`, `POST /image-to-video/{model}`, poll `GET /tasks?task_ids=…`. **Needs a paid resource pack** (our account has none) |
| Same presenter voice everywhere | Not solved | (a) more Veo talking clips per line, or (b) self-hosted voice conversion on a GPU: Sarvam Punjabi audio → presenter's voice (open-source models, e.g. Seed-VC / OpenVoice) **(verify Punjabi quality)**, or (c) a paid voice-cloning API **(verify Punjabi support)** |
| Lip sync for (b)/(c) | n/a | Lip-sync model on the presenter clip (self-hosted, or the Kling lip-sync feature) **(verify)** |
| Music | Blocked | Licensed music library, or a music-generation API **(verify licence for ads)** |

### 9.1 Proposed backend flow
```
POST /creative-lab/projects/:id/reels         { template: "presenter_reel" | "real_tour" | "twilight", lang: "pa-IN" }
  1. plan     → pick shots from knowledge cards (rules + 1 Gemini call)
  2. script   → captions + voice lines from frames (1 Gemini call, fact-check vs brief)
  3. ai_shots → for each AI shot: create provider job (Veo / Kling / MiniMax), store job id
  4. poll     → worker polls provider every 15–30 s, downloads MP4 to storage
  5. guard    → Gemini compares first/last AI frames with the real photo:
                "is the building the same?" → reject shots that redraw it (the crane-shot problem)
  6. voice    → Sarvam per line, pace-fit to shot length
  7. render   → ffmpeg job in media-tools: segments, labels, ASS captions, mix, loudnorm
  8. review   → reel saved as DRAFT with a per-shot label list; a human approves before posting
GET  /creative-lab/reels/:id                   → status per step, preview URL, cost so far
```

Data to store per reel: template, shots (source asset or AI job), provider + model + prompt + cost per AI shot, the label shown on screen, script, voice files, final file, status.

### 9.2 Guardrails to keep in the API version
- Facts only from the brief. The script step rejects anything else.
- Every AI shot carries its label automatically. The end-card footnote is generated from the actual shot list, so it can't be wrong again.
- AI may change only light, weather or camera; the building check in step 5 enforces this.
- Presenters are always fictional, AI-generated people, labelled on screen.
- Provider retries with backoff. Veo errored often in the POC, so cap the attempts per shot and report the failure instead of looping.
- Daily or monthly cost cap per organisation.

---

## 10. Plan: what's next, in order

### Progress (2026-11-26)

| Done | Where |
|---|---|
| Creative Lab page: brief → facts, uploads → Gemini knowledge cards | Backend + frontend, branch `feature/creative-lab-poc-lakshay` |
| Reels: villa Hindi/Punjabi (real footage), E (real + AI twilight), F (AI Sardar ji intro + real + lux captions) | `poc-output/`, scripts in `poc/creative-lab/` |
| 4 reels published to Cloudinary, shown under "4. Generated results" | `npm run creative-lab:publish`, `poc/creative-lab/results.json` |
| 5 reference reels studied; style guide written | [`REFERENCE_REELS.md`](REFERENCE_REELS.md) |

**What the reference study changed:** our reels are accurate but don't look finished. The gap is mostly **editing and text**, not AI generation: speech-synced subtitles with one gold key word, two fonts only, one colour grade, a location map card, logo in and out, clean transitions, presenter on site. Most of that is ffmpeg/ASS work on footage we already have, so it comes right after clean-up (**step 2**). Clean-up stays **step 1**: every later step (reel G, AI shots, posts) should use cleaned, improved files, never the raw uploads.

### Order (updated 2026-11-26)

| # | Step | Needs | Cost |
|---|---|---|---|
| 1 | **Clean / improve every uploaded creative before use** | Gemini analysis (already there), ffmpeg/sharp, upscaler, Nano Banana for inpaint | Free (Colab) / Gemini |
| 2 | Reference-style finishing → rebuild reel F as **reel G** from cleaned files | Cleaned files + voices, Whisper (local), fonts, logo, map facts | Free |
| 3 | One voice for Sardar ji, in 3–4 settings | Veo daily limit (Gemini app) | Free |
| 4 | Image first, then video, for AI shots | Nano Banana + Veo | Free (limits) |
| 5 | 3 formats end to end (walkthrough, update, teaser) | Steps 1–4 | Free |
| 6 | Free testing round, record cost per shot | Sheet | Free |
| 7 | Buy tools, build the API flow | Budget | Paid |

Steps 1–6 can run on **free tiers and websites** (via the Chrome extension, as in the POC). Money is spent only in step 7, after we know which tools are worth it.

### Step 1: Clean every creative before it's used — BUILT 2026-11-26 (safe fixes)

**What exists now** (file detail on the Creative Lab page → "Clean-up (step 1)"; code `src/modules/creativelab/cleanup.ts` + `service.ts` `startCleanup/cleanOne`):
1. **AI check (1 Gemini text request, stored as `asset.fixPlan`)**: orientation (upright / upside down / quarter turn), tilt, converging verticals (camera up/down), exposure, colour cast, noise, blur, temporary clutter. Prompt `buildFixPlanPrompt` in `knowledge.ts`. Videos send 3 frames from the useful part.
2. **Tilt is measured without AI** (`measureTilt`: Sobel edges, dominant angle within ±12° of vertical, confidence). Used when confidence ≥ 0.2; otherwise no straightening (no guessing). Gardens / wide-angle streets correctly get low confidence.
3. **Fixes** (`buildCleanFilters`, updated 2026-11-26 after "still not clear enough"): videos are trimmed to the kept shots → stronger 2-pass stabilisation (vidstab shakiness 8, smoothing 35: gimbal-like) → **deflicker** (auto-exposure pumping) → turn upright → straighten (rotate + minimal zoom) → perspective fix → light/colour → **Real-ESRGAN AI upscale** → resize to long side 1920 + light sharpen. Nothing changes the layout of the property.
   - **Real-ESRGAN** (free, open source, runs locally on the Mac GPU via Vulkan/Metal) restores detail and removes WhatsApp compression blocks and grain; it does not add or remove objects. Photos: `realesrgan-x4plus` ×4 (~35 s per photo). Videos: `realesr-animevideov3` ×2 on every frame (~0.5 s per frame, so a 20 s clip ≈ 5–6 min; runs in the background queue). The original sound is kept.
   - **Setup (each machine):** download `realesrgan-ncnn-vulkan-20220424-macos.zip` from the official releases page (github.com/xinntao/Real-ESRGAN/releases, v0.2.5.0, 52 MB), unzip into `realestate/tools/realesrgan/` (next to the two repos, not in git), `chmod +x realesrgan-ncnn-vulkan`. Or set `REALESRGAN_PATH`. Linux/Windows builds exist on the same page. Without it, clean-up falls back to plain ffmpeg (bigger, not sharper).
4. Result stored as `asset.cleaned` (Cloudinary `creative-lab/cleaned/`), page shows **before / after**, list of fixes, the AI notes and any clutter; **Approve** / **Reject** / Undo. An "Orientation" selector overrides the AI (found a WhatsApp clip filmed upside down).
5. If Gemini is busy or out of free requests (20/day per model on the free tier), clean-up still runs: measured straightening + basic fixes, with a note to "Clean again" later.
- API: `POST /admin/creative-lab/assets/:id/clean` `{ replan?, orientation? }` (202, queued, one at a time), `POST /assets/:id/cleaned/status` `{ APPROVED|REJECTED|READY }`.
- Tested on 3 samples (tilted photo, wide-angle street, upside-down shaky video). Tests: `tests/creativelab_cleanup.test.ts`.
- **Not yet:** AI clutter removal (1c below), using `cleaned.url` in reel building (step 2 should use approved cleaned files), a "clean all" button.

The original plan for this step follows.
Today the analysis only *describes* problems. Next, it should **fix them before any reel or post uses the file**.

1. **Analysis lists fixable issues** per photo and per video shot (the knowledge card already has `qualityIssues`). Add where each one is and how bad it is: blur / out of focus, noise or WhatsApp compression, too dark / bright, tilted horizon, shake, colour cast, clutter (bags, tools, wires), unpainted or unfinished patches, glare.
2. **Choose a fix per issue:**

   | Issue | Fix | Tool idea |
   |---|---|---|
   | Blur, low resolution, compression | Upscale + sharpen + denoise | AI upscaler (e.g. Real-ESRGAN, free) or the Gemini image model; ffmpeg `hqdn3d`/`unsharp` for video |
   | Dark / bright / colour cast | Exposure + white balance + light grade | sharp / ffmpeg `eq`, `colorbalance` |
   | Tilt, shake | Straighten, stabilise | sharp rotate; ffmpeg `vidstab` (already used) |
   | Small clutter, a stain, a missing paint patch | AI clean-up (inpaint) | Gemini image edit (Nano Banana) with a mask/prompt |
   | Whole video too soft | Frame-by-frame upscale + denoise | Video upscaler on a GPU (Colab), or a paid upscale API |
3. **Keep both versions:** `original` + `cleaned`, with the list of fixes applied stored on the asset. The UI shows before/after, and the admin approves before the cleaned file is used.
4. **Honesty rule for clean-up:**
   - **Always OK:** light, colour, sharpness, noise, straightening and stabilising.
   - **OK with care:** removing temporary clutter (bags, tools, wires).
   - **Not OK without a visible "virtually enhanced" label:** anything that changes the **actual state of the property**, such as painting an unpainted wall, finishing unfinished work, or adding furniture or greenery. Buyers will visit, so a cleaned photo must still match what they'll see.
5. Video: run the same checks per shot (from the knowledge card's shot list), clean only the shots we plan to use, and re-check frames after cleaning.

### Brand & location card (built 2026-11-26)
On each test project (left column, under the facts):
- **Logo / icon upload** (PNG/JPG/WebP, ≤ 8 MB; SVG not accepted for security) → `project.brand`, file in Cloudinary `creative-lab/brand/`.
- **Nearby places** (up to 8): name + time (min/hr) and/or distance (km/m) + optional direction (N…NW, north up) → `project.places`. Only what is typed is ever shown.
- **Map card** (`project.mapCards`, history, latest first), style **Flat** or **3D** (4 looks each; each Regenerate uses the next look):
  - **Generate (free)**, default: Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`, free daily allowance) draws only the background scene with no text; `src/modules/creativelab/mapCardRender.ts` then draws the pin, project name, labels with chips, connector lines, north arrow (if directions), "Not to scale" and the logo with sharp/SVG. **Text is always exact.** Needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Workers AI permission) in the backend `.env`.
  - **Gemini (paid)**: Gemini image model draws the whole card from `buildMapCardPrompt` (logo attached). Looks more integrated but may misspell, so check. Our Gemini keys have no free image quota (403 / limit 0): needs billing.
  - **Show prompt / Upload image I made**: make the card on the Gemini website (free, manual) and attach it. Done once via the Chrome extension on 2026-11-26 (3D look, all text correct, Gemini ✦ mark in a corner).
  - Every card starts **Needs check**; Approve needs the "names and numbers are correct" tick.
- API: `PUT/DELETE /admin/creative-lab/projects/:id/logo`, `PUT .../places`, `GET .../map-card/prompt?style=`, `POST .../map-cards` `{ style: flat|3d, engine: free|gemini }`, `POST .../map-cards/upload`, `POST .../map-cards/:cardId/status`.

### Step 2: Reference-style finishing (reel G)
Goal: the same TDI villa content, but looking like reference R5/R1 in [`REFERENCE_REELS.md`](REFERENCE_REELS.md) (Part C is the checklist).
1. **Word timings:** run Whisper (word timestamps, free, local) on the Punjabi/Hindi voice tracks → `data/words_*.json`. Fallback: Sarvam text + even spacing per shot.
2. **"Subtitles" caption style** in `caption_styles.py`: white bold sans, words build up as spoken (max 3 lines), **one key word per phrase in gold serif italic** on its own line (Playfair Display, OFL licence), next phrase ghosts in; text never over a face (bottom-middle over the presenter, top over busy shots); soft dark gradient at the bottom instead of a box.
3. **Headline + pill style** for fact screens ("5.37 Acres"-type): serif headline + white rounded pill(s), rise-in, bloom-out.
4. **One grade** on every shot (same LUT + vignette), so phone footage and Veo clips match.
5. **Location map card:** a designed graphic (like reference R5), not a satellite photo or Google Map: the project pin in the middle, nearby places around it as labels with distance chips ("Airport · 15 min"), an animated line. Input = a list of places + distances from the builder/brief (no coordinates needed). Optional: the site's Google Maps link / lat-long, only to put places in the right direction; without it the layout is schematic and marked "not to scale". If there are no facts, skip the card.
6a. **Brand assets and places come from the page** ("Brand & location" card, built 2026-11-26): see below.
6. **Brand:** small logo in a corner throughout; project logo whip-in at the start and end card at the end (logo from the uploads).
7. **Transitions:** white flash, light leak, motion-blur whip only.
8. Use the **cleaned** files from step 1. Publish reel G next to F on the Creative Lab page (`results.json`) and compare.

Done when reel G passes the Part C checklist and stays facts-only and labelled.

### Step 3: One voice for Sardar ji (in 3–4 settings)
- **3a (free, now):** Veo clips 2 and 3 (features; price + call to action), so the whole reel is in his own Veo voice. Prompts are ready in section 8.3.
- **3b (scalable):** test voice conversion on Colab. Sarvam speaks the correct Punjabi words, then the audio is converted to Sardar ji's voice using his clip-1 audio as the sample. Compare it with 3a by ear. If it's good, any line in any project can use his voice without Veo limits.
- Keep the **same presenter image** for every project, so he becomes a recognisable "RealCRM presenter".
- New from the references: the presenter should appear **through the whole reel in 3–4 settings** (R1, R5), not only in the intro. Make 3–4 key images of him (Nano Banana: garden, entrance, terrace, inside) → one Veo clip each, all in his own voice.
- For "project update" reels (reference R2) a **real person on site** works better than an AI presenter.

### Step 4: Image first, then video
Veo does much better when it starts from a strong image, as we saw with the presenter and twilight shots. So every AI shot becomes two steps:
1. **Make the key image:** the cleaned real photo/frame → Gemini image edit (light change, presenter added, twilight sky…) → **admin approves the image**. This step is cheap, so it's easy to retry.
2. **Animate it:** the approved image → Veo (or Kling/MiniMax) image-to-video → check the building is unchanged → use.

This catches bad results at the cheap image stage instead of after a slow, limited video generation.

### Step 5: Finish 3 formats end to end
Pick from the idea library ideas that work with what builders actually upload. Target: **A (presenter walkthrough, R5 style), D or E, plus C**:

| Idea | Made from | Status |
|---|---|---|
| **A. Punjabi presenter walkthrough** | Presenter image + Veo talking clips + real shots | Intro done; needs step 2 finishing + step 3 voice |
| **B. Golden hour → twilight transformation** | Cleaned exterior photo → image (twilight) → Veo or MiniMax start/end frame | Twilight clip done; needs the image-first version + its own reel |
| **C. Cinematic real-footage tour** | Cleaned real shots + lux captions + voice + music | Reels done; needs step 1 clean-up + music |
| **D. Project update / "big news"** (reference R2) | Real site + drone footage, presenter on site, 2–3 headline words | New; needs real on-site footage |
| **E. Milestone teaser, no presenter** (reference R3) | Title slams, gold numbers, AI aerial with glowing plot outline, logo end card | New; cheap, good first test of the brand look |

Later, once builders upload the right material: drone reveal (needs real drone footage, or a clearly labelled AI shot) and construction timelapse (needs dated construction photos).

Each idea is "done" when it's a 30–45 s reel that is accurate (facts from the brief), labelled, and good enough to post.

### Step 6: Free testing round, then compare
- Make the 2–3 reels using the free tiers we have: Gemini app (Veo, daily limit), Kling (66 credits/day), Hailuo (80 credits), Colab (free GPU), Sarvam.
- Spread the work over a few days to stay inside each tool's daily free limit.
- **Use legitimate accounts only.** Creating extra email accounts to get more free credits usually breaks the providers' terms and can get accounts banned. Use real team members' own accounts, or the small trial credits some providers offer.
- For every shot, record the tool, credits/cost, time taken, number of retries, and whether the building stayed correct. A simple sheet is enough.

### Step 7: Decide what to buy, then test properly with APIs
1. From the step 6 sheet, pick **1 main video tool + 1 backup, 1 image tool, 1 voice tool** (and music).
2. Buy the smallest paid plan or API credits for those only.
3. Build the API flow from section 9 behind the Creative Lab page: `POST /projects/:id/reels` → jobs → draft reel for review.
4. Re-make the same 2–3 reels through the API and compare them with the website versions. Measure **cost per reel** against the monthly target (4–5 reels + 6–7 posts per project).
5. Only then commit the work, open it up beyond the test page, and plan the monthly planner.

### Who does what (POC way of working)
- **User:** signs in to every website, approves results, moves downloaded files into `poc-output/clips/`, listens to the voices.
- **Claude Code:** drives Chrome through the Claude in Chrome extension for the website steps, writes the scripts, builds the reels, checks frames for building changes and keeps this doc up to date.
