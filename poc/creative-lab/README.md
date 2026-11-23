# Creative Lab POC scripts (reel building)

A **copy** of the scripts used to build the POC reels. Status, architecture and plan: [`docs/CREATIVE_LAB_POC.md`](../../docs/CREATIVE_LAB_POC.md). Read that first.

These are POC scripts, **not product code**:
- They hard-code local paths (`/Users/.../realestate/poc-output`, ffmpeg-full in Homebrew, Creative Lab asset IDs).
- They were run by hand. The working copy and all outputs (videos, AI clips, voices, segments; about 750 MB) are in `realestate/poc-output/` on the developer's machine and are **not in git**.
- API keys come from the backend `.env` (`GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `SARVAM_API_KEY`). No keys are stored in these files.

| File | Purpose |
|---|---|
| `lib.sh` | Shared ffmpeg helpers: top name band, honesty labels, real-shot clean-up (vidstab 2-pass, denoise, sharpen) |
| `build_reel.sh`, `build_now.sh`, `build_v2.sh`, `build_nocap.sh` | Early tower reels (**misleading: the towers are not this property**; kept for reference) |
| `build_villa.sh` | Villa segments + facts-only end card |
| `script_from_frames.py`, `script_villa.py` | Gemini writes captions and Hindi/Punjabi voice lines from real frames, checked against the brief → `data/*.json` |
| `voices.py`, `voices_villa.py`, `tts_all.py`, `tts_test.py` | Sarvam TTS (`bulbul:v3`), pace fitted to shot length |
| `captions.py` | Caption styles: pop, highlight (karaoke), stack |
| `caption_styles.py` | Caption styles: chunks, slide, typewriter, **lux** (chosen) |
| `build_voiced.py`, `build_variant.py`, `build_variant_villa.py` | Voiced reels; `build_variant.py` supports ducked music |
| `build_E.py` | Reel E: real villa + AI twilight |
| `build_F.py` | Reel F: AI Punjabi presenter + real footage + twilight, lux captions |
| `results.json` | Which finished reels appear on the Creative Lab page; publish with `npm run creative-lab:publish` |
| `data/` | Generated scripts (captions, key words, voice lines, voice lengths) |

AI clips (Veo / Kling / Hailuo) were made on the providers' websites through the Claude in Chrome extension, not by API. See section 8.3 of the doc for the prompts.
