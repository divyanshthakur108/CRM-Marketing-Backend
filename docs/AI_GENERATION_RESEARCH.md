# AI Content Generation — Research & Recommendations

**Scope:** the AI generation flow for Indian real estate clients (languages: **Hindi, English, Punjabi, Hinglish**).
**Status:** research only, no code changed. Prices are as of **Oct 2026**. They change often, so check the linked official pages before buying.
**Decisions so far:** use **APIs first** (self-host later if volume justifies it). For video editing, **compare all three options** (ffmpeg, Shotstack/Creatomate, Remotion). See §9.

---

## 1. The flow

```
 Onboarding (project info + photos/videos)
        │
        ▼
 Monthly plan  ── e.g. 10 posts + 4 reels, dates + platforms + content type per slot
        │
        ▼
 Reminder (N days before each slot): "Next post is on 3 Nov — upload new content by 31 Oct?"
        │
   ┌────┴─────────────────────────────┐
   ▼                                  ▼
 Client uploaded NEW raw video/photos   No new content by the deadline
   │                                  │
   ▼                                  ▼
 Rule-based auto-edit (no AI)       AI generation from the client's earlier content
 captions, watermark, end card,     (re-cut + AI image edits + AI motion + voiceover),
 merge clips, music                 with a uniqueness check
   └────────────────┬─────────────────┘
                    ▼
        Review & approve (client) → Publish (Instagram / Facebook)
```

| Step | Already in the code | Status |
|---|---|---|
| Onboarding | `src/config/onboardingSteps.ts`, `src/models/Project.ts` | Exists, but missing inputs (§2) |
| Monthly plan | `src/modules/plans/service.ts` | Exists, but fixed dates and generic text (§3) |
| Daily job that triggers generation | `src/scheduler/rollingScheduler.ts` (02:00 cron, `GENERATION_LEAD_DAYS`) | Exists |
| Job queue / worker | `src/queue/jobQueue.ts`, `src/worker.ts` | Exists |
| Reminder to the client | `src/models/Notification.ts` (in-app) | Model exists; the reminder rule isn't built |
| Raw-video auto-edit | `creativeEngineService.ts` has ffmpeg reel and poster code | Partial; no caption burn-in, end card or merge rules |
| AI generation | `aiStudioService.ts`, `creativeEngineService.ts`, `presenterWalkthroughService.ts`, `occasionEngine.ts`, `voiceoverService.ts` | Exists; images and video blocked until Gemini billing is enabled |
| Storage | Cloudinary (`src/storage/localStorage.adapter.ts`) | Working |
| Publish | `src/modules/publishing/` | Meta is still on the mock adapter (out of scope here) |

---

## 2. What the client must give at onboarding

The AI can only be as good as its inputs. Every fact printed on a creative (price, RERA, phone) must come from here; it is never invented.

**Already collected** (`onboardingSteps.ts` + Project): company name, phone, address, city/state, developer category, project name and type, RERA number, brand name, tagline, colors, logo, disclaimer format, price range, amenities, location.

**Missing, and needed for good generation:**

| Input | Why |
|---|---|
| **Project stage**: pre-launch / under construction / ready to move | Decides the content mix and style (investment vs. family) |
| **Configurations**: BHK types and sizes per unit | Captions and on-screen facts |
| **Offers and payment plans**, with validity dates | Offer posts. Never auto-create offers |
| **Landmarks and distances** (airport, schools, IT hubs) | Location posts |
| **Sales phone / WhatsApp per project** | CTA on every creative |
| **Preferred languages** (any of Hindi, English, Punjabi, Hinglish) | Captions and voiceover |
| **Footage type tags**: drone, presenter (face-to-camera), walkthrough, construction progress, handover, testimonial | Each content type needs different footage. `MediaAsset.category` currently has only EXTERIOR/INTERIOR/ROOMS/… |
| **Rights consent** on media | Already exists (`rightsConsent`) |
| **Music preference** (or "no music") | Licensing (§12) |

---

## 3. Monthly plan logic (rules, not AI)

The plan should be decided by clear rules. AI only writes the text and makes the media.

**1. Volume from budget/package.** Example package: **10 posts + 4 reels / month**, configurable. Spread evenly: posts about every 3 days, reels about weekly. Avoid two slots on the same day.

**2. Content mix by project stage** (starting point to tune with real results):

| Stage | Emphasis |
|---|---|
| Pre-launch | Location and connectivity, EOI/booking urgency, investment angle, render/elevation posts |
| Under construction | Construction milestones (date-stamped), payment plan/offers, site-visit CTA |
| Ready to move | Walkthrough reels, presenter tours, handover and testimonials, family lifestyle |

**3. Content types (from the earlier analysis of the managed GDPL / ACE pages):** presenter walkthrough, property cinematic/drone, 4:5 photo grid/carousel, festival post, offer/payment-plan banner, handover/testimonial, construction milestone, location/corridor hook, skyline/stats reel, pre-launch EOI card. Each needs a template (size, overlays, caption formula). Today the code only has *poster* and *reel*.

**4. Festival calendar.** Indian festivals take priority over the normal rotation. Prepare content **about 14 days ahead**. Fixed dates: New Year (1 Jan), Lohri (13 Jan), Baisakhi (13/14 Apr), Independence Day (15 Aug). Lunar dates that change yearly and need a yearly table: Holi, Navratri, Dussehra, Diwali. Punjab clients get Lohri/Baisakhi by default.

**5. Platform per content type.** Facebook for **lead ads** (the most-cited paid lead channel in India), Instagram Reels and feed for **reach and visual content**, YouTube Shorts as an optional extra for walkthroughs. **There is no published benchmark** for how often Indian developers should post or which platform converts best. Start with the cadence above and measure leads per platform. One real Gurugram realty brief asked for about 2 reels/week. Sources: [Privyr](https://www.privyr.com/blog/tag/running-real-estate-facebook-lead-ads/), [Wisoft](https://www.wisoftsolutions.com/in/blog/real-estate-digital-marketing-india), [Freelancer brief](https://www.freelancer.de/projects/adobe-premiere-pro/face-reels-for-gurugram-realty).

**6. Meta limits.** Instagram allows 100 API-published posts per 24 hours. Meta's page also mentions 50, so check the `content_publishing_limit` endpoint. Reels are published with `media_type=REELS`. Source: [Meta content publishing docs](https://developers.facebook.com/docs/instagram-platform/content-publishing).

---

## 4. Reminder rule

For each upcoming slot:

1. **T − 4 days** (e.g. 30 Oct for a 3 Nov post): in-app and email alert. *"Your next post is on 3 Nov. Do you have new photos or videos? Upload by 31 Oct, or we'll create it from your existing library."*
2. **T − 3 days (deadline):**
   - New content uploaded and consented → **raw-edit path** (§5).
   - Nothing uploaded → **AI path** (§6).
3. **T − 2 days:** creative ready for client review. If it isn't approved by T − 1, flag it rather than auto-publish.

The days are configurable per client. This fits the existing daily `rollingScheduler` plus `Notification`. Only the rule needs building.

---

## 5. Raw-video auto-edit (rules, not AI)

Goal: a client sends a raw phone video or several clips, and we output a branded 9:16 reel with the same steps every time.

| Step | Tool | Notes |
|---|---|---|
| 1. Normalize | ffmpeg | 1080×1920, 30fps, H.264 + AAC, loudness-normalized. Landscape clips get a blurred-background fill, not a crop |
| 2. Pick good parts | [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) (BSD-3) + silence detection | Split into scenes, drop shaky, too-dark or too-short parts, trim long silences |
| 3. Order and merge | ffmpeg concat + 0.3–0.5s crossfades | Order: exterior → living → bedrooms/kitchen → balcony/amenities. Target length 20–45s |
| 4. Captions | Speech-to-text → subtitles | [Sarvam Saaras v3](https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/overview) has a **codemix** mode, so Hinglish speech comes out right. Burn in with ASS subtitles (see the Indic text note below) |
| 5. Brand layer | ffmpeg overlay | Corner watermark (logo or org name), lower-third with project name |
| 6. Fixed end card (1–2s) | Pre-made per style preset | Logo animation + project name + phone/WhatsApp + RERA number. **Phone and RERA are shown only if provided** |
| 7. Music | Licensed track, ducked under speech | See licensing in §12 |
| 8. Output | Upload to Cloudinary, create the creative for review | Existing flow |

**Indic text rendering (important).** Hindi (Devanagari) and Punjabi (Gurmukhi) need "complex shaping". Without it, letters break or show as boxes. Use **ASS subtitles rendered by libass built with HarfBuzz**, with **Noto Sans Devanagari / Noto Sans Gurmukhi** fonts. Don't use ffmpeg `drawtext` for Indic captions. Check that the server's ffmpeg is built with libass and HarfBuzz. Sources: [ffmpeg-kit issue #23](https://github.com/arthenica/ffmpeg-kit/issues/23), [ffmpeg-devel shaping patch](https://ffmpeg.org/pipermail/ffmpeg-devel/2021-March/277946.html).

---

## 6. AI path: no new content, but output must be unique and feel human

Rules that make the output feel like a human editor made it and not a repeat:

1. **Build from the client's real material first.** Re-cut existing clips in a new order or length, or with a new hook, pace or music. That is cheap, honest and on-brand.
2. **AI image edits use the client's real photos** (relighting, cleanup, twilight look, 4:5 crops). Never create the building from text alone: an invented property in an ad is misleading.
3. **AI motion:** short 4–6s image-to-video clips from real photos ([Veo 3.1](https://ai.google.dev/gemini-api/docs/pricing) Lite/Fast, or [Kling](https://www.cloudzero.com/blog/kling-ai-pricing/)), stitched by the edit pipeline. Label it "AI-generated / illustrative".
4. **Script and captions** with Gemini text, written in the client's languages. Use the 5-step formula: hook → location → configuration → urgency + CTA → RERA + hashtags. Prompts contain **only the client's facts** and forbid invented prices, amenities, phone or RERA (already enforced in `captionService.ts`).
5. **Voiceover** with [Sarvam Bulbul](https://www.sarvam.ai/apis/text-to-speech) (Hindi, Punjabi, English-India) or Gemini TTS. Use the same voice per client for consistency.
6. **Uniqueness checks:**
   - Perceptual hash of every output image or frame, rejected if too similar to the last 60 days (dHash already exists in `aiStudioService.ts`).
   - Store a "recipe" per creative (photos used, order, hook, music, content type, template) and don't repeat the same combination within N weeks.
   - Rotate hooks, music, templates and content types across the month.
7. **Human touches:** vary length (15/30/45s), vary the first 2 seconds (hook), use the client's own presenter clips when available, and keep the language natural (Hinglish where the client uses it).

---

## 7. Third-party services and prices (Oct 2026, verify before buying)

### AI text (scripts, captions, photo understanding)
| Service | Price | Notes |
|---|---|---|
| Gemini 3.8 Flash | $0.75 in / $3.75 out per 1M tokens (to 31 Dec 2026), then $1.50 / $7.50 | Free tier exists. Slow in our test (~48s for a tiny prompt) |
| Gemini Flash-Lite | $0.30 in / $2.50 out per 1M tokens | Free tier. Cheap for captions |
| `gemini-3.5-flash` | Works with our key (2s); not listed on the pricing page | Currently used in code (`GEMINI_TEXT_MODEL`) |

Source: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (page updated 2026-10-28). Text cost per client per month is negligible (well under $1).

### AI images (edits of the client's photos)
| Model | 1K image | 2K image | Free tier |
|---|---|---|---|
| Gemini 3.1 Flash Image (Nano Banana 2) | $0.067 | $0.101 | No |
| Gemini Nano Banana 2.1 | $0.034 | $0.050 | No |
| Gemini 3 Pro Image | $0.134 | $0.134 | No |

Source: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing). **Our key currently gets "quota exceeded / billing", so billing must be enabled.**

### AI video (image-to-video motion)
| Model | Price per second | Notes |
|---|---|---|
| Veo 3.1 Lite | $0.05 (720p) / $0.08 (1080p) | No free tier |
| Veo 3.1 Fast | $0.10 (720p) / $0.12 (1080p) / $0.30 (4K) | |
| Veo 3.1 Standard | $0.40 (720p/1080p) / $0.60 (4K) | |
| Gemini Omni Flash | ≈ $0.10 (720p) | On the official pricing page |
| Kling (various versions) | ≈ $0.04 – $0.17 | **Sources conflict widely**; check Kling's own page |

Veo 2 (still the default in our `.env`) **has been shut down**. Change it to a Veo 3.1 model. Sources: [benchlm Veo](https://benchlm.ai/media-pricing/veo), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Kling – CloudZero](https://www.cloudzero.com/blog/kling-ai-pricing/), [Kling – CostBench](https://costbench.com/software/ai-media-apis/kling-api/).

### Voiceover (TTS)
| Service | Price | Hindi | Punjabi | Notes |
|---|---|---|---|---|
| **Sarvam Bulbul v3** | ₹30 per 10,000 chars (v2: ₹15) | ✅ | ✅ | Indian company, 30+ voices. A V4 Flash promo at ₹10/10k chars was reported (unverified) |
| Gemini 3.8 Flash TTS | ≈ $0.00225 per 10s audio (2026) | Check | Check | Free tier exists |
| Google Chirp 3 HD | $30 per 1M chars | ✅ | Preview | Standard voices $4/1M |
| ElevenLabs v3 | ≈ $0.10 per 1,000 chars | ✅ | Not confirmed | Most expensive |
| `google-tts-api` (current code) | Free, unofficial | ✅ | ? | Uses Google Translate's voice: not suitable for production |

Sources: [Sarvam TTS](https://www.sarvam.ai/apis/text-to-speech), [Sarvam pricing](https://sarvam.ai/api-pricing), [Bulbul docs](https://docs.sarvam.ai/api-reference-docs/models/bulbul), [Google TTS pricing](https://cloud.google.com/text-to-speech/pricing), [ElevenLabs pricing snapshot](https://www.activepieces.com/blog/elevenlabs-pricing-2026-plans-credits-and-costs.md), [Bulbul V4 promo report](https://runtimewire.com/article/sarvam-bulbul-v4-flash-pricing-launch).

### Speech-to-text (captions for client videos)
| Service | Price | Notes |
|---|---|---|
| **Sarvam Saaras v3** | ₹30 / hour of audio (₹45 with speaker diarization) | Modes: transcribe, translate, transliterate, **codemix** (Hinglish). ₹1,000 free credits. Saarika v2.5 is legacy |
| Gemini (audio input) | Token-based | Option if we want one vendor |
| Whisper (self-host) | GPU cost only | See §8 |

Sources: [Sarvam STT overview](https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/overview), [Sarvam pricing](https://docs.sarvam.ai/api-reference-docs/pricing), [smallest.ai summary](https://smallest.ai/blog/sarvam-ai-speech-to-text-pricing).

### Video editing / rendering
| Option | Price | Notes |
|---|---|---|
| **ffmpeg** (already in code) | Free (server cost) | Full control. Indic captions via libass + HarfBuzz |
| **Shotstack** API | From ~$39/month (200 credits = 200 min at up to 1080p) | JSON templates, hosted rendering. Third-party price figure |
| **Creatomate** API | From ~$45–54/month (2,000 credits; ~37 credits per 1080p minute) | Template editor. Third-party price figure |
| **Remotion** (React video) | Free for companies of **up to 3 people**; above that a paid **Company License** (official docs: "Automators" plan $0.01/render, $100/month minimum; other sources conflict) | Code-based templates, renders on our server or Lambda |

Sources: [Shotstack pricing guide](https://www.wireflow.ai/blog/shotstack-pricing), [Creatomate pricing guide](https://www.wireflow.ai/blog/creatomate-pricing), [Creatomate vs Shotstack](https://creatomate.com/compare/shotstack-alternative), [Remotion license](https://www.remotion.dev/docs/license), [Remotion pricing](https://www.remotion.dev/docs/license/pricing).

---

## 8. Open-source / self-host options (later)

| Project | License | What it's useful for |
|---|---|---|
| [MoneyPrinterTurbo](https://wavect.io/blog/moneyprinterturbo-review-2026/) | MIT, ~112k stars | Reference pipeline (script → voice → subtitles → video); has a local-files mode |
| [OpenReels](https://github.com/tsensei/OpenReels) | MIT | TypeScript + Remotion, word-timed animated captions; close to our stack |
| ShortGPT | — | Idea: the LLM writes the edit plan as JSON, and code renders it |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | BSD-3 | Scene cuts for raw client videos |
| [AI4Bharat Indic Parler-TTS](https://huggingface.co/ai4bharat/indic-parler-tts) | Apache 2.0 | Self-hosted TTS. Hindi official; **Punjabi only "unofficial"** |
| Whisper | MIT | Self-hosted speech-to-text (weaker on Hinglish than Sarvam codemix) |

**When self-hosting pays off:** a GPU VM costs a fixed amount every month (roughly ₹40k+ for an always-on GPU, which varies by provider). At 10 posts + 4 reels per client, API costs per client are small (§11), so APIs are cheaper until there are many clients. Revisit at about 50+ active clients.

---

## 9. Video-edit bake-off (to run next)

You chose to compare all three options. Use the same inputs and rules for each.

**Inputs:**
- 2 raw client clips: one face-to-camera Hinglish clip and one walkthrough
- 1 logo
- project facts

**Rules:**
- 9:16 1080p, 20–45s
- burned-in captions in Hindi, Punjabi (Gurmukhi) and Hinglish (Roman)
- corner watermark
- 2s end card with phone and RERA
- background music ducked under speech
- merge with crossfades

**Score each option (1–5):**

| Criterion | ffmpeg | Shotstack / Creatomate | Remotion |
|---|---|---|---|
| Hindi/Punjabi text renders correctly | | | |
| Visual quality / polish | | | |
| Render time per reel | | | |
| Cost per reel at 4 reels × N clients | | | |
| Ease of making new templates | | | |
| Lock-in / can run on our server | | | |

**Accounts needed:** Shotstack sandbox key (free sandbox), Creatomate trial, Remotion (free while the team is ≤ 3 people; check the license for your company size). ffmpeg needs `brew install ffmpeg` locally, and a build with libass and HarfBuzz on the server.

---

## 10. Language notes (India)

- **Hindi:** Devanagari script. Captions in Devanagari. Voice: Bulbul `hi-IN`.
- **Punjabi:** **Gurmukhi** script. Voice: Bulbul `pa-IN` (supported). Google Chirp `pa-IN` is preview only. Font: Noto Sans Gurmukhi.
- **Hinglish:** most real estate reels use **Roman script** captions ("Aapka dream ghar"). Speech-to-text should use **codemix** mode. Voice: Hindi voice reading Roman Hinglish — test quality per vendor.
- **English:** Indian-English voice (Bulbul `en-IN`).
- **Per client:** store the preferred caption language(s) and voice language separately (e.g. Hinglish captions + Hindi voice).
- **Fonts:** bundle the Noto Sans Devanagari / Gurmukhi fonts on the server. Never rely on system fonts.

---

## 11. Recommended stack (APIs first) + estimated cost per client

| Need | Recommended |
|---|---|
| Captions / scripts / photo analysis | Gemini Flash (text) |
| Image edits from real photos | Gemini 3.1 Flash Image or Nano Banana 2.1 |
| AI motion clips | Veo 3.1 Lite or Fast (try Kling as an alternative) |
| Voiceover | Sarvam Bulbul v3 (Hindi + Punjabi + English) |
| Captions from client speech | Sarvam Saaras v3 (codemix) |
| Editing / rendering | Decide after the bake-off (§9); ffmpeg is the default |
| Storage | Cloudinary (already working) |

**Rough monthly AI cost for one client with 10 posts + 4 reels.** Assumptions: 2 image variants per post; reels made with AI motion (5 clips × 4s = 20s each); ~600 characters of voiceover per reel; 1.5× for retries and regenerations.

| Item | Calculation | ≈ Cost |
|---|---|---|
| Images | 20 × $0.034–0.067 × 1.5 | $1.0 – $2.0 |
| AI motion video | 4 reels × 20s × $0.08–0.12 × 1.5 | $9.6 – $14.4 |
| Voiceover | 4 × 600 chars at ₹30/10k × 1.5 | ≈ ₹11 (<$0.20) |
| Text (Gemini) | small | < $0.50 |
| **Total (AI only)** | | **≈ $11 – $17 / client / month** |

- If the client sends their own video (raw-edit path), the video cost becomes **almost zero**: only speech-to-text at ≈ ₹0.5 per minute.
- Using Veo 3.1 Standard instead of Lite/Fast multiplies video cost by about 4×.
- Editing-API subscriptions (Shotstack/Creatomate) are extra if chosen.
- Cloudinary, server and Meta ad spend are not included.

---

## 12. Open questions and risks

1. **Gemini billing:** must be enabled; images and video are blocked on the current key. Also change `GEMINI_VIDEO_MODEL` from Veo 2 (shut down) to Veo 3.1.
2. **Music licensing:** only use licensed or royalty-free tracks (store the license per track). Instagram can mute or flag unlicensed music.
3. **Offers and claims:** offers, prices and RERA come only from client input, with validity dates. The AI never creates them. Every creative needs client approval before publishing.
4. **AI labeling:** mark AI-generated or edited visuals as illustrative; real estate ads with misleading visuals are a compliance risk.
5. **Meta App Review:** needed before real publishing. It is separate from this AI work but can take weeks.
6. **No public benchmarks:** posting frequency and platform choice should be tuned from the client's own lead data.
7. **Punjabi quality:** test Bulbul `pa-IN` voice and Gurmukhi captions with a native speaker before launch.

---

## 13. Sources

- Gemini API pricing — https://ai.google.dev/gemini-api/docs/pricing
- Veo pricing snapshot — https://benchlm.ai/media-pricing/veo · https://the-decoder.com/google-veo-3-adds-1080p-916-video-and-drops-prices-by-half/ · https://www.developersdigest.tech/blog/image-video-generation-api-pricing-2026
- Kling pricing — https://www.cloudzero.com/blog/kling-ai-pricing/ · https://costbench.com/software/ai-media-apis/kling-api/
- Sarvam TTS — https://www.sarvam.ai/apis/text-to-speech · https://docs.sarvam.ai/api-reference-docs/models/bulbul · https://sarvam.ai/api-pricing · https://runtimewire.com/article/sarvam-bulbul-v4-flash-pricing-launch
- Sarvam STT — https://docs.sarvam.ai/api-reference-docs/speech-to-text/apis/overview · https://docs.sarvam.ai/api-reference-docs/pricing · https://smallest.ai/blog/sarvam-ai-speech-to-text-pricing
- Google Cloud TTS — https://cloud.google.com/text-to-speech/pricing
- ElevenLabs — https://www.activepieces.com/blog/elevenlabs-pricing-2026-plans-credits-and-costs.md · https://elevenlabs.io/zh/text-to-speech/punjabi
- Shotstack / Creatomate — https://www.wireflow.ai/blog/shotstack-pricing · https://www.wireflow.ai/blog/creatomate-pricing · https://creatomate.com/compare/shotstack-alternative
- Remotion — https://www.remotion.dev/docs/license · https://www.remotion.dev/docs/license/pricing
- Indic text in ffmpeg — https://github.com/arthenica/ffmpeg-kit/issues/23 · https://ffmpeg.org/pipermail/ffmpeg-devel/2021-March/277946.html
- Open source — https://wavect.io/blog/moneyprinterturbo-review-2026/ · https://github.com/tsensei/OpenReels · https://github.com/Breakthrough/PySceneDetect · https://huggingface.co/ai4bharat/indic-parler-tts
- Meta publishing — https://developers.facebook.com/docs/instagram-platform/content-publishing · https://bundle.social/blog/instagram-api-rate-limits
- Platforms in India — https://www.privyr.com/blog/tag/running-real-estate-facebook-lead-ads/ · https://www.wisoftsolutions.com/in/blog/real-estate-digital-marketing-india · https://www.freelancer.de/projects/adobe-premiere-pro/face-reels-for-gurugram-realty
