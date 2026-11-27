# Creative Lab: handover (start here)

**Status: 2026-11-27.** Branch `feature/creative-lab-poc-lakshay` in both repos (`CRM-Marketing-Backend`, `CRM-Marketing-Frontend`).
This file is the single entry point: what Creative Lab is, how to run it, what is built, how each part works, which AI is used where, the rules, and the plan. Deeper detail lives in the linked docs.

| Read next | For |
|---|---|
| [`CREATIVE_LAB_POC.md`](CREATIVE_LAB_POC.md) | Full history of the POC, architecture diagrams, manual steps and prompts, API automation plan |
| [`REFERENCE_REELS.md`](REFERENCE_REELS.md) | 5 reference reels (the finished look we want), shot by shot, caption animations, style guide |
| [`IDEA_LIBRARY.md`](IDEA_LIBRARY.md) | Reel / post ideas |
| [`../poc/creative-lab/README.md`](../poc/creative-lab/README.md) | The hand-run POC scripts that built the first reels |

---

## 1. What Creative Lab is

RealCRM makes real-estate marketing content (reels and posts) from what a builder uploads. Target: **4–5 reels + 6–7 posts per project per month, as cheaply as possible, facts only from the builder.**

Creative Lab is the **admin-only test page** where we build and prove each step before it goes into the product:
`http://localhost:5173/admin/creative-lab` (platform admin only). Test data is in its own database (`realcrm_creative_lab`), never mixed with real projects.

Pipeline we are building, step by step:

```
Builder input ──► 1. Understand ──► 2. Clean up ──► 3. Brand & location ──► 4. Make shots ──► 5. Edit reel ──► Review ──► Publish
 (facts + files)   (knowledge        (fix every      (logo, nearby         (AI image →       (captions, voice,
                    cards, Gemini)    file first)     places, map card)     AI video)         grade, logo, map)
     ✅ built         ✅ built (A)      ✅ built            ⏳ partly (POC)    ⏳ POC scripts      ⏳ later
```

---

## 2. New developer setup

Things **not in git** that every machine needs. The page shows a **Setup checklist** (top of the left column, `GET /admin/creative-lab/setup`): it turns amber and prints the fix when something is missing.

| # | What | How | If missing |
|---|---|---|---|
| 1 | Repos | Clone both repos side by side in one `realestate/` folder; checkout `feature/creative-lab-poc-lakshay` | — |
| 2 | Backend `.env` | Copy `.env.example`. Ask the team for the shared values: `MONGODB_URI` (shared Atlas cluster), `CLOUDINARY_*`, `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. **Never commit `.env`; never paste keys in chats** | With a local DB / no Cloudinary you won't see the team's projects, files or results |
| 3 | ffmpeg (full build) | macOS: `brew install ffmpeg-full`, set `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` | Stabilise / deflicker / captions fail |
| 4 | Real-ESRGAN (AI upscaler) | `cd CRM-Marketing-Backend && npm run setup:realesrgan` → official release v0.2.5.0 (~50 MB) into `realestate/tools/realesrgan/` (outside git). Elsewhere: set `REALESRGAN_PATH`. Needs a Vulkan GPU (Apple Silicon OK) | Clean-up still runs but only enlarges (not sharper) |
| 5 | Run backend | `PORT=5050 npm run dev` (port 5000 is macOS AirPlay) | — |
| 6 | Run frontend | `API_PROXY_TARGET=http://127.0.0.1:5050 npm run dev` | **403 at login** = frontend is talking to AirPlay on 5000 |
| 7 | Sign in | Platform admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (`npm run seed:admin`) | Others get "Platform administrator privileges required" |

**Where the work lives:** code in the repos; every file (uploads, cleaned files, logos, map cards, finished reels) in **Cloudinary**; all records in the **shared MongoDB** (`realcrm_creative_lab`). So whatever one developer makes on the page, everyone sees. Hand-made POC outputs stay on the original developer's machine in `realestate/poc-output/` (not in git); the good ones were published to the page.

---

## 3. What is built (on the page)

Page: `CRM-Marketing-Frontend/src/pages/AdminCreativeLabPage.tsx`. Backend module: `CRM-Marketing-Backend/src/modules/creativelab/`.

| Part | Where on the page | Status |
|---|---|---|
| Test project + typed info → **facts (brief)** | 1. Project | ✅ |
| Upload photos / videos → **knowledge card** per file (what's in it, shots, quality, best uses) | 2. Upload, 3. What the AI understood | ✅ |
| **Clean-up** per file: before / after, approve | File detail → "Clean-up (step 1)" | ✅ safe fixes (A). AI tidy (B) not yet |
| **Brand & location**: logo upload, nearby places, **map card** (flat / 3D) | Left column card | ✅ |
| **Generated results**: finished reels shared with the team | 4. Generated results | ✅ (4 POC reels published) |
| **Setup checklist** | Top of left column | ✅ |

Backend files:

| File | What |
|---|---|
| `model.ts` | `CreativeLabProject` (brief, brand, places, mapCards), `CreativeLabAsset` (knowledge, fixPlan, cleaned), `CreativeLabResult` |
| `knowledge.ts` | All Gemini prompts + the pure functions that clean Gemini's answers (brief, image/video knowledge, fix plan, places, map card prompts) |
| `service.ts` | Upload + analysis queue, clean-up queue, brand/places/map cards, results |
| `cleanup.ts` | Clean-up engine: tilt measurement, ffmpeg filter chains, Real-ESRGAN, setup check |
| `mapCardRender.ts` | Draws map-card text, pins, labels and logo on an AI background (exact text) |
| `routes.ts` | All endpoints (below) |
| `src/scripts/publishCreativeLabResults.ts` | `npm run creative-lab:publish`: puts finished reels from `poc/creative-lab/results.json` on the page |
| `scripts/setup-realesrgan.sh` | `npm run setup:realesrgan` |

Tests: `tests/creativelab_knowledge.test.ts`, `tests/creativelab_cleanup.test.ts` (`npx vitest run tests/creativelab_*`). Note: 3 older tests (`videolab_render_integration`, `showcase_poster`, `videolab_library`) already failed before this work.

---

## 4. How each part works

### 4.1 Understanding uploads (knowledge cards)
Upload → file stored in Cloudinary → queued (one at a time) → **Gemini** looks at the photo, or the video (with scene cuts and audio) → JSON knowledge card: space, elements, finishes, quality issues, shots with best start/end, keep/skip, best idea uses. Same file again = card reused, no AI request. Facts come only from what is visible or typed.

### 4.2 Clean-up (step 1): make every file usable before anything uses it
Button **"Clean up"** on a file → queued → result shown **before / after** with the list of fixes → **Approve** (later steps use the cleaned file) or **Reject** (original is used). An **Orientation** selector overrides the AI.

Order of work for each file:

| # | Step | How | AI? |
|---|---|---|---|
| 1 | **AI check** (fix plan) | Gemini looks at the photo / 3 video frames: orientation (upside down / sideways), tilt, leaning vertical lines, exposure, colour cast, noise, blur, temporary clutter. Stored as `fixPlan` (1 request, reused) | Gemini (reads only) |
| 2 | Trim | Video cut to the "keep" shots from the knowledge card | No |
| 3 | **Stabilise** | 2-pass vidstab, strong smoothing → gimbal-like (only if "shaky") | No |
| 4 | **Deflicker** | Removes auto-exposure brightness pumping (videos) | No |
| 5 | Turn upright | Flip / quarter turn (found a WhatsApp clip filmed upside down) | No |
| 6 | **Straighten** | Tilt **measured from wall / door edges** (Sobel edges, ±12°, accurate to ~0.5°); only applied when confident, never guessed | No |
| 7 | Vertical lines | Perspective fix when the camera pointed up / down | No |
| 8 | Light & colour | Exposure, contrast, saturation, colour cast | No |
| 9 | **AI upscale** | **Real-ESRGAN**: photos ×4 (`realesrgan-x4plus`, ~1 min), videos ×2 every frame (`realesr-animevideov3`, ~0.5 s/frame → ~7 min for 18 s). Restores detail, removes WhatsApp blocks / grain. Does not add or remove objects | AI (detail only) |
| 10 | Final | Resize to long side 1920, light sharpen, original sound kept | No |

If Gemini is busy or out of free requests, clean-up still runs (measured straightening + all non-AI fixes) and says "Clean again later". Results on 3 samples: 464×832 shaky upside-down clip → upright, steady, flicker-free, 1070×1920, crisp; photos clearly sharper with the same building.

### 4.3 Brand & location (map card)
- **Logo / icon** upload (PNG/JPG/WebP; SVG refused for security).
- **Nearby places** (up to 8): name + time (min/hr) and/or distance (km/m) + optional direction (N…NW, north up). **Only what is typed is ever shown.**
- **Map card** (9:16), style **Flat** or **3D**, 4 looks each; Regenerate = next look:
  - **Generate (free)** — default: **Cloudflare Workers AI (FLUX.1 schnell)** draws only the background scene (no text). Our code (`mapCardRender.ts`) draws the pin, project name, labels with time/distance chips, lines, north arrow, "Not to scale" and the logo. **Text is always exact.**
  - **Gemini (paid)**: Gemini draws everything (looks more integrated, may misspell). Needs Gemini billing.
  - **Show prompt / Upload image I made**: make it on the Gemini website by hand and attach it.
  - Every card starts **Needs check**; approve after ticking "names and numbers are correct".

### 4.4 Generated results (finished reels)
Finished reels are uploaded to Cloudinary and listed on the project page for everyone. Add one: edit `poc/creative-lab/results.json`, run `npm run creative-lab:publish` (safe to re-run). Each has a verdict (Good to use / Check first / Don't use) and an **"AI used"** note.

### 4.5 The POC reels (made by hand, before the page could do it)
Built with scripts in `poc/creative-lab/` + AI shots made on websites (Gemini/Veo, Kling, Hailuo) through the Claude in Chrome extension. Best so far: **Reel F** (AI Punjabi presenter "Sardar ji" intro + real villa footage + lux captions + Punjabi voice). Details: `CREATIVE_LAB_POC.md` sections 3–8.

---

## 5. Which AI / tool is used where

| Job | Tool | Cost / limit |
|---|---|---|
| Knowledge cards, briefs, clean-up check | **Gemini** text model (`GEMINI_TEXT_MODEL`) | Free tier ≈ 20 requests/day per model |
| Map card background (free) | **Cloudflare Workers AI**, `@cf/black-forest-labs/flux-1-schnell` | Free daily allowance (resets 05:30 IST) |
| Map card full image | **Gemini image** (`GEMINI_IMAGE_MODEL`, "Nano Banana") | Paid only (free tier = 0) |
| Upscale / detail restore | **Real-ESRGAN** (local, open source) | Free, uses the Mac GPU |
| Stabilise, deflicker, straighten, colour, encode | **ffmpeg** (full build) | Free |
| Voice (POC) | **Sarvam** TTS `bulbul:v3` (Hindi / Punjabi) | Paid key |
| AI video shots (POC) | **Veo** on the Gemini website (also tried Kling, Hailuo) | Website free limits (~4–5 Veo clips/day) |
| AI image edits (POC) | **Nano Banana** on the Gemini website | Website free limits |

---

## 6. Rules we keep (important)

1. **Facts only from the builder** (typed info / files). Never invent prices, sizes, distances, places, amenities.
2. **Honest visuals.** Clean-up may fix light, colour, sharpness, tilt, shake, and later remove *temporary* clutter. It must **not** paint walls, finish construction, or **add plants / greenery / objects** that aren't there — buyers visit the site. Anything AI-changed gets an **"AI-enhanced"** tag; AI presenters / AI shots are labelled in the reel.
3. **Human approval** before anything is used: cleaned files, map cards and AI shots all start as "check".
4. **Secrets:** keys only in `.env` (git-ignored). Keys pasted in chats must be rotated.
5. Test data stays in `realcrm_creative_lab`.

---

## 7. The plan (in order)

| # | Step | Status | Notes |
|---|---|---|---|
| 1A | **Clean-up: safe fixes** | ✅ Done | Section 4.2. Next: a "Clean all files" button |
| 1B | **Clean-up: AI tidy** | ⏳ Next | Gemini image edit on photos / key frames: remove litter, stains, loose wires, debris, dull sky; **same layout, buildings, plants**; "AI-enhanced" tag. Videos: cleaned key frame → short Veo clip. Needs Gemini billing, or done by hand on the website |
| — | Brand & location (logo, places, map card) | ✅ Done | Section 4.3 |
| 2 | **Reference-style finishing → reel G** | ⏳ | Rebuild reel F from **approved cleaned files** in the style of `REFERENCE_REELS.md`: word-by-word subtitles synced to the voice (Whisper timings) with one gold serif key word, one colour grade, logo in/out, map card, clean transitions |
| 3 | One voice for Sardar ji, in 3–4 settings | ⏳ | More Veo clips in his own voice, or voice conversion; same presenter image every project |
| 4 | Image first, then video, for AI shots | ⏳ | Approve the AI image (cheap) before animating it (Veo / Kling) |
| 5 | 3 formats end to end | ⏳ | Presenter walkthrough (like ref R5), project update (R2) or milestone teaser (R3), cinematic real-footage tour |
| 6 | Free testing round | ⏳ | Record tool, cost, time, retries, "building unchanged?" per shot |
| 7 | Buy tools, build the API flow | ⏳ | `POST /projects/:id/reels` → jobs → draft reel for review; measure cost per reel |

Open problems: Gemini free limits (20/day; image = 0), two different voices in reel F, reel E's end card wrongly says "all actual footage" (kept off the page), POC reels are hand-built (no API yet).

---

## 8. API (all under `/api/v1/admin/creative-lab`, platform admin)

| Method | Path | What |
|---|---|---|
| GET | `/usage` | Gemini requests today |
| GET | `/setup` | Setup checklist for this machine |
| GET | `/ideas` | Idea tags |
| GET / POST | `/projects` | List / create test project (info → brief) |
| GET / PUT / DELETE | `/projects/:id` | Project with assets + results / update info / delete |
| POST | `/projects/:id/assets` | Upload a file (queued analysis) |
| POST | `/assets/:assetId/reanalyze` | Analyze again |
| DELETE | `/assets/:assetId` | Remove file record |
| POST | `/assets/:assetId/clean` | Start clean-up `{ replan?, orientation? }` |
| POST | `/assets/:assetId/cleaned/status` | `{ status: APPROVED \| REJECTED \| READY }` |
| PUT / DELETE | `/projects/:id/logo` | Upload / remove logo |
| PUT | `/projects/:id/places` | Save nearby places |
| GET | `/projects/:id/map-card/prompt?style=` | Prompt for the website route |
| POST | `/projects/:id/map-cards` | Generate `{ style: flat \| 3d, engine: free \| gemini }` |
| POST | `/projects/:id/map-cards/upload` | Attach a map card made elsewhere |
| POST | `/projects/:id/map-cards/:cardId/status` | `{ status: NEEDS_CHECK \| APPROVED \| REJECTED }` |
| POST | `/projects/:id/results` | Upload a finished reel |
| DELETE | `/results/:resultId` | Remove a result from the page |

---

## 9. How we have been working

- The admin signs in to every website and approves results; Claude Code builds features, runs scripts, and drives Chrome (Claude in Chrome extension) for website-only AI steps, with the user signed in.
- Nothing is committed or pushed without the developer asking.
- When something new is built: update this file (sections 3, 4, 7) and `CREATIVE_LAB_POC.md` section 10.
