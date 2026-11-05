# Video Lab: how videos and captions are made

Last updated: 2 Nov 2026

This document covers the video editing work done so far:
- **Step 1:** the admin Video Lab with an ffmpeg renderer.
- **Speech captions:** added after Step 1, because clients won't type captions.
- **Clip understanding + smart cut:** the system watches each clip and decides where to cut it and in what order to use the shots.

For the wider plan (AI providers, prices, open-source options), see `AI_GENERATION_RESEARCH.md`. For the whole app, see `OVERVIEW.md`.

---

## 1. What exists today

| Piece | Status |
|---|---|
| Admin page **Video Lab** (`/admin/video-lab`) to test without creating an org or project | Done |
| Upload raw clips (1–5), optional logo, optional music → stored on Cloudinary | Done |
| Edit rules: vertical 1080×1920, crossfades, watermark, branded end card, music lowered under speech | Done |
| Captions in **Hindi, Punjabi, Hinglish, English** with correct Indic letters | Done |
| **Captions from speech**: Gemini listens to each clip and writes timed captions | Done |
| Captions you type yourself (spread evenly over the video) | Done (fallback) |
| **Clip understanding**: shots, room type, quality, problems, speech, best part, keep/cut, with thumbnails | Done |
| **Smart cut**: picks the best shots up to a target length (15/30/45/60 s), property-tour order, never cuts mid-sentence | Done |
| 1–3 **variants** from the same inputs | Done |
| "How this video was made" panel: every step, its time, the exact ffmpeg command, the recipe JSON | Done |
| Other engines (Shotstack, Creatomate, Remotion) for comparison | Step 2: not started; needs keys |
| Connect to the real client flow (plan slots, reminders, approvals) | Step 4: not started |

**How to test:** log in as `admin@realcrm.in` → profile menu or Admin Console → **Video Lab**.

---

## 2. How captions are fetched from speech

### The short version
1. **ffmpeg pulls the sound** out of the clip as a small audio file.
2. That audio is **sent to Google Gemini** with clear instructions: "write captions for exactly what is spoken, in this script, in short pieces, with start and end times."
3. Gemini **listens** and returns JSON: a list of `{start, end, text}`.
4. Our code **cleans** the list (sorts it, removes overlaps, keeps times inside the clip).
5. The page **shows the captions** so you can fix any word.
6. At render time each caption is **moved to the right place in the final video** and burned in.

Gemini is not speech-to-text software. It's a general AI model that can also listen to audio. That lets it do more than a plain transcriber in a single step:
- write Hindi speech in **Roman letters** (Hinglish), or in **Gurmukhi**
- **translate** into English
- keep common words like "BHK", "site visit" and "RERA" in English

### Step by step

```
Clip uploaded (Cloudinary)
        │
        ▼
[1] ffmpeg: extract audio ── first 25 s, mono, 16 kHz, MP3 48 kbps (~150 KB)
        │
        ▼
[2] Gemini (GEMINI_TEXT_MODEL, e.g. gemini-3.5-flash)
      input:  the audio + instructions (language/script rules)
      output: {"hasSpeech": true, "spokenLanguage": "Hindi",
               "segments": [{"start": 1.2, "end": 3.15, "text": "Mohali mein hamare naye project mein"}, ...]}
        │
        ▼
[3] cleanCues(): sort, drop empty text, min 0.6 s on screen, no overlaps, clamp to clip length
        │
        ▼
[4] Page shows the captions per clip → admin can edit the text
        │
        ▼
[5] Render: captions travel WITH their clip, then shift onto the merged timeline
        │
        ▼
[6] ASS subtitle file → burned in by ffmpeg (libass + HarfBuzz + Noto fonts)
```

#### [1] Extracting the audio
File: `CRM-Marketing-Backend/src/modules/videolab/transcribe.ts`

```bash
ffmpeg -i clip.mp4 -t 180 -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k speech.mp3
```
- `-t 180`: up to 3 minutes (smart cut can use any part of that).
- `-vn`: drop the picture; speech needs only the sound.
- `-ac 1 -ar 16000`: one channel at 16 kHz, enough for speech and keeps the upload small.
- If the clip has **no sound at all**, we stop and say so ("This clip has no sound"). Nothing is made up.

#### [2] Instructions sent to Gemini
The audio goes inline with the request (no separate upload). The instructions say:
- Only use **words that are actually spoken**: no adding, summarizing, prices or claims that weren't said.
- Split into **short captions, at most 6 words**, at natural pauses.
- `start`/`end` in seconds (0.1 s precision), **matching when the words are spoken**.
- Ignore music and background noise.
- If there's no clear speech, return `hasSpeech: false` and nothing else.

Plus one **script rule** for the chosen caption language:

| Caption language | Rule given to Gemini | Example output for Hindi speech |
|---|---|---|
| Hindi | Devanagari script; BHK/flat/RERA/site visit may stay in English; translate if the speech isn't Hindi | `मोहाली में हमारे नए प्रोजेक्ट में` |
| Punjabi | Gurmukhi script; same English-word rule; translate if the speech isn't Punjabi | `ਮੋਹਾਲੀ ਵਿੱਚ ਸਾਡੇ ਨਵੇਂ ਪ੍ਰੋਜੈਕਟ ਵਿੱਚ` |
| Hinglish | Hindi/Punjabi words in Roman letters exactly as spoken; English stays English; never Devanagari/Gurmukhi | `Mohali mein hamare naye project mein` |
| English | English; translate Hindi/Punjabi faithfully into simple English | `In our new project in Mohali` |

The response is requested as JSON (`responseMimeType: application/json`) and parsed strictly. If Gemini returns something unreadable, the request fails with a clear error. We never substitute fake captions.

#### [3] Cleaning the result
Function `cleanCues()` in `src/modules/videolab/recipe.ts`:
- sorts captions by start time and drops empty ones
- keeps every caption on screen for **at least 0.6 s**, so it's readable
- ends a caption **0.05 s before the next one** starts, so they never overlap
- removes anything past the end of the clip

#### [4] Review on the page
Each clip shows its captions with times, for example `0:01.2–0:03.2  Mohali mein hamare naye project mein`. The text is editable. Times are kept as Gemini gave them.

#### [5] Keeping captions in sync after merging
Captions are saved **per clip**, with times measured from the start of that clip. Variants can change the clip order, and the captions move with their clip.

When the clips are merged with crossfades, clip *n* starts at:

```
start of clip n = (sum of the lengths of the clips before it) − (n × crossfade length)
```

Example: clip A is 7.2 s, the crossfade is 0.4 s, so clip B starts at 6.8 s. B's caption at 3.1 s is shown at 9.9 s. Function: `placeCuesOnTimeline()`.

#### [6] Burning captions into the video
Captions are written to an **ASS subtitle file** and burned in by ffmpeg's `subtitles` filter (libass + HarfBuzz):
- **HarfBuzz** joins Hindi and Punjabi letters correctly (matras, half-letters). The usual ffmpeg `drawtext` gets these wrong.
- Mixed lines such as `3 BHK flat अब तैयार हैं` switch fonts mid-line: Noto Sans Devanagari for Hindi, Noto Sans for English.
- Two looks: **boxed** (white text on a dark box) or **outline** (white text with a black outline). Both sit above Instagram's bottom buttons.

### Errors you might see (all honest, no fake output)

| Message | Meaning | What to do |
|---|---|---|
| "This clip has no sound…" | The clip has no audio track | Use typed captions, or a clip with sound |
| "No speech found" (on the page) | There's sound but no talking (e.g. only music) | Normal. That clip gets no captions |
| "…has used up its free daily limit" | Free tier: about 20 Gemini requests per day per model | Try tomorrow, or enable billing |
| "…hit Gemini's requests-per-minute limit (free tier)" | Too many requests in one minute | Wait about a minute and click again |
| "…Gemini is overloaded right now" | Google's servers are busy; we already retried 3 times | Try again in a minute |
| "…quota is used up or billing is not enabled" | Daily free quota is gone, or the model needs billing | Enable billing in Google AI Studio |
| "…no Gemini API key is configured" | `GEMINI_API_KEY` is missing in the backend `.env` | Add the key |

### Speed and cost
- About **5–12 s per clip** (a 7 s clip took about 5.5 s).
- Clips are processed **one at a time**, to stay under the free-tier per-minute limit.
- Gemini counts audio as about **32 tokens per second**, so a 25 s clip is about 800 tokens: very cheap on a paid plan, and currently free on the free tier.

### Limits and later improvements
- Gemini's timestamps are good to about 0.1–0.3 s. On long or fast speech they can drift slightly.
- If we need word-level timing (karaoke-style word highlights), a dedicated speech-to-text service fits better:
  - **Sarvam Saaras** (Indian languages, mixed Hindi/English speech; needs a Sarvam API key)
  - **Whisper** (open source, run on our own machine)

  The Lab can compare them side by side with Gemini.

---

## 3. How clips are understood, and how the cuts are chosen

### The short version
1. **ffmpeg finds exact cut points.**
   - Hard cuts: where the picture suddenly changes.
   - Pauses: where nobody is speaking.
2. **Gemini watches the clip** and describes every shot: what room it is, how good it looks, what's wrong with it, whether someone talks, which part is best, and whether to keep it.
3. **Our code fixes the shot edges** so they land on ffmpeg's exact cut points.
4. **You see every shot** with a thumbnail and can untick any you don't want.
5. **The cut planner** (plain rules, no AI) picks the shots, trims them and puts them in order.

The two halves do different jobs:
- **Gemini** understands **what** is in the video, but its timestamps are only accurate to about 1 second (it looks at roughly 1 frame per second).
- **ffmpeg** knows **exactly when** the picture changes and when there's a pause.

Combining them gives cuts that are both sensible and precise.

### Step by step
File: `CRM-Marketing-Backend/src/modules/videolab/analyze.ts`

```
Clip (up to 3 min used)
  │
  ├─[1] ffmpeg: preview copy (640px, 10 fps, mono audio). Small and fast to scan and send.
  │
  ├─[2] ffmpeg: hard cuts   select='gt(scene,0.30)'   → e.g. [0.4, 1.8, 57.3, 71.6]
  │     ffmpeg: loudness    astats per ~45 ms window → median loudness
  │
  ├─[3] ffmpeg: pauses      silencedetect at (median − 3 dB) for ≥ 0.2 s
  │       The threshold adapts per clip: real clips have fans, traffic and music and are never fully silent.
  │       Example: the 75 s talking test clip went from 0 pauses (fixed −32 dB) to 23 pauses (adaptive −18 dB).
  │
  ├─[4] Gemini watches the preview (video + sound) and returns, per shot:
  │       start/end, label ("Compact bathroom with sink"), category (AERIAL, EXTERIOR, ENTRANCE, LIVING,
  │       KITCHEN, BEDROOM, BATHROOM, BALCONY_VIEW, AMENITY, LOCATION, PRESENTER, OTHER), quality 1–5,
  │       hookScore 1–5, issues (shaky, blurry, too_dark, overexposed, camera_pointing_down, obstructed,
  │       frozen, black, accidental, text_or_watermark…), hasSpeech, bestStart/bestEnd, keep, reason
  │
  ├─[5] normalizeShots(): valid values only; edges snapped to the exact hard cuts (within 0.7 s);
  │       no gaps or overlaps; shots shorter than 0.4 s merged into the previous one
  │
  └─[6] thumbnail from the middle of every shot (160px JPEG, shown on the page)
```

### Real example (75 s apartment tour with a presenter talking)
| Time | Decision | Gemini's reason |
|---|---|---|
| 0:00–0:00.4 | **Cut** | Close-up of a package, shaky and blurred |
| 0:00.4–0:01.8 | **Cut** | Irrelevant intro shot of a package |
| 0:01.8–0:07.8 | Keep (speech) | Good general view of the studio layout |
| 0:07.8–0:20 | Keep (speech) | Shows the practical stair storage |
| 0:20–0:47.7 | Keep (speech) | Presenter talking about the apartment |
| 0:47.7–0:57.3 | Keep (speech) | Entrance door and closet storage |
| 0:57.3–1:11.6 | Keep (speech) | Bathroom with sink and washer |
| 1:11.6–1:13 | **Cut** | Overexposed glare frame between camera angles |
| 1:13–1:15 | Keep | Clear shot of the living/work area |

### The cut planner (smart cut rules)
File: `src/modules/videolab/cutPlan.ts`. These are plain rules and run instantly, with no AI call.

1. **Only ticked shots** are used.
2. **B-roll** (shots without speech):
   - uses its **best part**, skipping shaky starts and accidental endings
   - is capped at **4.5 s** per shot (**2.5 s** in "fast cuts")
   - is skipped if shorter than 1.2 s
3. **Speech is never cut mid-word.** The edges of a speech shot move to the nearest pause (up to 0.8 s away). Speech plays in the order it was said.
4. **Choosing shots for the target length:**
   - Speech gets up to 70% of the target, because it carries the message.
   - The rest is filled with the best b-roll. Score = quality × 2 + hook × 0.5, and each serious problem (watermark, blur, dark…) costs 2.
5. **Order:**
   - B-roll follows a **property tour**: drone → exterior → entrance → living → kitchen → bedroom → bathroom → balcony/view → amenities → location.
   - When there's speech, b-roll is placed **between the speech blocks**, like cutaways between sentences.
6. **Cuts that continue each other** in the same clip are joined back into one cut, so there's no crossfade in the middle of a sentence.
7. **Crossfade** between cuts: 0.25 s. Whole-clip mode uses 0.4 s.

The 3 variants use 3 cutting styles:

| Variant | Cutting style |
|---|---|
| A | **Story order** (property tour) |
| B | **Best shot first**: the strongest opening shot with no problems, max 2.5 s, then story order |
| C | **Fast cuts**: shots up to 2.5 s, so more shots fit |

### Captions with smart cut
Speech captions are made for the whole clip. Each cut keeps only the captions spoken inside it (a caption needs at least half of itself inside the cut). The captions are re-timed from the start of the cut, then placed on the final timeline. They stay in sync whatever order the cuts are in.

### Speed, limits, cost
- **Understanding takes** about 10–20 s for a 10 s clip and about 60 s for a 75 s clip. Almost all of that is Gemini.
- **Gemini's free tier allows only about 20 requests per day per model.** Each clip uses 1 request to understand it and 1 per language for captions. For real use, **enable billing** on the Gemini key. A video costs about 300 tokens per second, so a 1-minute clip is about 18k tokens: cents, not rupees.
- **The planner doesn't overlay b-roll on top of continuing speech** (the presenter's voice continuing over room shots). That's a natural next improvement.

---

## 4. How a video is made (the full edit pipeline)

The admin's inputs become an **edit recipe**: plain JSON describing the video. ffmpeg renders it.

The recipe doesn't depend on any one engine. In Step 2, Shotstack, Creatomate and Remotion can render the **same recipe** for a fair comparison.

### Inputs → recipe → video

```
Admin inputs (clips, logo, music, org/project/phone/RERA, caption language + source, number of variants)
        │
        ▼
buildVariants()  →  1–3 recipes (same facts, different presentation)
        │
        ▼
renderRecipeWithFfmpeg()  →  reel.mp4 + poster.jpg  →  Cloudinary
```

### Render steps (shown in "How this video was made")
1. **Fetch inputs.** Download the clips, logo and music from Cloudinary if they aren't on this machine. Smart cut also logs the cut plan as a step.
2. **Cut and normalize each piece.** Take `start`–`end` from the source clip (whole-clip mode: from 0, up to 25 s), then make it 1080×1920, 30 fps:
   - Landscape clips aren't cropped. They sit on a **blurred copy of themselves** to fill the frame.
   - Speech volume is evened out (`loudnorm`).
   - A clip with no sound gets silence, so merging still works.
3. **Merge clips** with 0.4 s crossfades (picture and sound).
4. **Captions + watermark:**
   - Captions are burned in (section 2).
   - Watermark at top right: the logo (85% opacity), or the org name as text if there's no logo.
5. **End card** (2.4 s):
   - brand colour background, logo, project name, org name
   - **phone and RERA only if filled in**
   - fade-in, slight zoom
6. **Append the end card** with a short crossfade.
7. **Music.** Looped to fit, faded in and out, and turned down while someone speaks (`sidechaincompress`).
8. **Poster frame** for the preview.
9. **Upload** the final video and poster to Cloudinary.

A 2-clip, 15 s video takes about **15–40 s** to render on this Mac.

### Variants: "different videos from the same data"
Variants change only how the video looks. **Facts are never changed.**

| | Variant A | Variant B | Variant C |
|---|---|---|---|
| Smart cut | story order | best shot first | fast cuts |
| Whole clips | original order | first clip moved to the end | reversed |
| Caption look | boxed | outline | outline |
| End card | Heritage Luxury (navy/gold) | High-Growth (black/cyan) | Heritage Luxury |
| Music level | 22% | 16% | 30% |

### Example recipe (shortened)
```json
{
  "version": 2,
  "variant": { "index": 1, "label": "Variant B · smart cut, best shot first · outline speech captions · High-Growth end card" },
  "output": { "width": 1080, "height": 1920, "fps": 30, "maxSecondsPerClip": 25 },
  "editing": "smart",
  "targetSeconds": 30,
  "cuts": [
    { "key": "video-lab/assets/….mp4", "filename": "gouripur1.mp4", "start": 0, "end": 2.3,
      "label": "Archway structure overlooking exterior grounds" },
    { "key": "video-lab/assets/….mp4", "filename": "wuhan75.mp4", "start": 1.8, "end": 7.8,
      "label": "Overview of studio apartment interior",
      "cues": [{ "start": 0.2, "end": 1.9, "text": "…" }] }
  ],
  "transitionSeconds": 0.25,
  "captions": { "language": "hinglish", "style": "OUTLINE", "source": "speech", "lines": [] },
  "watermark": { "text": "Skyline Developers" },
  "endCard": { "template": "HIGH_GROWTH_ROI", "seconds": 2.4, "projectName": "Skyline Heights",
               "orgName": "Skyline Developers", "phone": "+91 98765 43210" },
  "music": null
}
```

---

## 5. API (platform admin only)

Base: `/api/v1/admin/video-lab`. Requires login as a platform admin.

| Method | Path | What it does |
|---|---|---|
| POST | `/assets` | Upload one file (field `file`): video (MP4/MOV/WebM), image (PNG/JPG/WebP) or audio (MP3/M4A/AAC/WAV). Checks the file is what it claims to be, then stores it on Cloudinary under `video-lab/assets/`. Returns duration, size and whether it has sound. |
| POST | `/analyze` | Body `{clipKey}`. Understands one clip: `{summary, shots[] (with thumbnails), sceneCuts[], silences[], analyzedSeconds, steps[], ms}`. |
| POST | `/transcribe` | Body `{clipKey, language}`. Returns the captions from that clip's speech: `{hasSpeech, spokenLanguage, cues[], model, ms}`. |
| POST | `/renders` | Body: clips (with optional `cues`, `shots`, `silences`, `durationSeconds`), logoKey, musicKey, facts, captions `{language, source: 'speech'|'typed', lines}`, `editing: 'smart'|'whole'`, `targetSeconds`, variants (1–3). Queues the videos; they render one at a time in the background. |
| GET | `/renders` | Latest 30 renders. Renders stuck for more than 20 minutes (e.g. after a server restart) are marked failed. |
| GET | `/renders/:id` | One render with status, steps, recipe and output links. |

---

## 6. Where the code is

**Backend** (`CRM-Marketing-Backend/`)

| File | Purpose |
|---|---|
| `src/modules/videolab/recipe.ts` | Recipe types, `buildVariants()`, `cleanCues()`, `cuesForCut()`, `placeCuesOnTimeline()` |
| `src/modules/videolab/analyze.ts` | Clip understanding (ffmpeg hard cuts, adaptive pauses, Gemini shot list, thumbnails) |
| `src/modules/videolab/cutPlan.ts` | Smart cut rules: which shots, which part, what order |
| `src/modules/videolab/transcribe.ts` | Captions from speech (ffmpeg audio extract → Gemini) |
| `src/modules/videolab/ass.ts` | Caption/end-card subtitle files, font switching for Hindi/Punjabi |
| `src/modules/videolab/ffmpegRenderer.ts` | The render pipeline (section 3) |
| `src/modules/videolab/service.ts` | Upload checks, queue, saving results |
| `src/modules/videolab/routes.ts` | API + input validation |
| `src/modules/videolab/model.ts` | `VideoLabRender` collection in MongoDB |
| `src/utils/ffmpeg.ts` | Finds ffmpeg, runs it, reads clip details |
| `src/utils/aiErrors.ts` | Turns Gemini failures into clear messages |
| `assets/fonts/` | Noto Sans / Devanagari / Gurmukhi (free OFL license) |
| `tests/videolab_recipe.test.ts` | 14 tests: variants, caption cleaning, timeline sync, subtitle output |
| `tests/videolab_cutplan.test.ts` | 12 tests: shot selection, best part, length target, hook choice, no mid-word cuts, b-roll between speech, parsers |

**Frontend** (`CRM-Marketing-Frontend/`)

| File | Purpose |
|---|---|
| `src/pages/AdminVideoLabPage.tsx` | The Lab page: uploads, details, speech captions review, clip understanding (shots + keep toggles), generate, results |
| `src/App.tsx`, `src/layouts/AppShell.tsx`, `src/pages/AdminOrganizationsPage.tsx` | Route and menu links |

---

## 7. Setup on a new machine

**Easiest on any OS (macOS, Windows, Linux): Docker.** Only ffmpeg runs in Docker; Node runs on your machine.
```bash
cd CRM-Marketing-Backend
docker compose up -d media-tools
```
Then `MEDIA_TOOLS=docker` in the backend `.env`, restart the backend, and skip step 1 below. Details: `OVERVIEW.md` → "Video tools".

Without Docker:

1. Install ffmpeg **with libass** (needed for Hindi/Punjabi captions):
   ```bash
   brew install ffmpeg-full
   ```
   The regular `brew install ffmpeg` does **not** include libass. On Windows use a "full" build (e.g. gyan.dev).
2. In the backend `.env`:
   ```
   FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg   # not needed with MEDIA_TOOLS=docker
   GEMINI_API_KEY=...            # needed for captions from speech
   GEMINI_TEXT_MODEL=gemini-3.5-flash
   CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=...
   ```
3. If ffmpeg fails with `Library not loaded: /usr/lib/libhvf.dylib`, run:
   ```bash
   brew reinstall --build-from-source freetype
   ```
4. On a Linux server, use an ffmpeg build with `--enable-libass --enable-libharfbuzz`. Most distro packages and the static builds include both.

---

## 8. Next steps (one at a time, each tested before the next)

> **Updated plan (5 Nov 2026): see `VIDEO_PIPELINE_PLAN.md`.** It replaces the order below: 1 animated captions → 2 B-roll over speech → 3 edit director → 4a content memory (search past posts and footage) → 4b project library as B-roll → 5 engine comparison → 6 caption engines → 7 client flow → 8 AI path. The POC stays on the Gemini free tier.

| Step | What | Needs from you |
|---|---|---|
| Next | **B-roll over speech**: the presenter keeps talking while room shots play on top (the usual reel style) | — |
| **Now** | Enable billing on the Gemini key (the free tier is about 20 requests/day, enough for only a few clips) | Google AI Studio billing |
| **2** | Engine dropdown in the Lab: ffmpeg vs **Shotstack** vs **Creatomate** vs **Remotion**, all rendering the same recipe, with a scorecard (quality, speed, cost) | Shotstack sandbox API key (free); Creatomate API key (trial). Remotion needs no key. |
| **3** | Compare caption engines: Gemini (today) vs **Sarvam Saaras** (word-level timing, Indian languages) | Sarvam API key (free credits on signup) |
| **4** | Use the chosen engine in the real client flow: new content for a plan slot → recipe → render → review → publish | — |
| Option | On/off switch for the end card, more end-card designs | — |
