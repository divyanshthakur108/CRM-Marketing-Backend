# Idea Library (draft, 2026-11-22)

The list of content ideas RealCRM can make for a project. Every month the planner picks
**4–5 videos and 6–7 posts per project** from this list, choosing ideas that:

1. the project has the right files for (read from the knowledge cards, see `src/modules/creativelab/`), and
2. were not used for that project recently.

Each idea has an **id**. The Creative Lab already tags every uploaded file with the ids it is good for
(`bestUses` in the knowledge card), using the ids in `IDEA_TAGS` in `src/modules/creativelab/knowledge.ts`.
Keep this file and that list in sync.

Each base idea has 2–3 variants (style, language, length), so the ~25 base ideas give 50–60 different pieces.

---

## How to read the tables

| Column | Meaning |
|---|---|
| **Needs** | Files the project must have, as knowledge-card spaces (`EXTERIOR_ELEVATION`, `LIVING`, `PRESENTER`, ...) or facts from the project brief |
| **How it's made** | Generation steps |
| **Tools** | Free = runs on our own GPU or the Gemini free tier; Paid = per-clip API |
| **Label** | `AI` = must carry "Artist's impression"; `REAL` = real footage/photos only; `FACTS` = uses only facts from the brief |

---

## A. From the elevation / exterior photo

| id | Idea | Needs | How it's made | Tools | Label |
|---|---|---|---|---|---|
| `drone_reveal` | Drone rise from street level to the full tower | `EXTERIOR_ELEVATION` (image-to-video score ≥ 3) | Image-to-video with a "slow drone rise" prompt, 5 s; end card | Free: Wan 2.2 / MiniMax H3 (FreeVideo) · Paid: Kling, Seedance, Veo | AI |
| `orbit_360` | Slow orbit around the building | `EXTERIOR_ELEVATION` or `AERIAL` | Image-to-video, orbit prompt | Same as above | AI |
| `construction_timelapse` | Empty plot → finished building | `EXTERIOR_ELEVATION` | Image edit makes an "empty plot" version; first/last-frame video from empty plot to the real elevation | Image: Nano Banana · Video: FreeVideo (first/last frame), Kling | AI |
| `construction_timelapse` (stages variant) | Plot → foundation → frame → finished | `EXTERIOR_ELEVATION` | 3–4 generated stage images, chained first/last-frame clips | Same | AI |
| `day_to_night` | Lights come on at dusk | `EXTERIOR_ELEVATION` with `lighting.timeOfDay` = day | Night version of the photo; transition clip | Nano Banana + image-to-video | AI |
| `weather_mood` | Monsoon / golden hour / winter fog over the same tower | `EXTERIOR_ELEVATION` | Image-to-video with a weather prompt | Same as `drone_reveal` | AI |

## B. From interior photos

| id | Idea | Needs | How it's made | Tools | Label |
|---|---|---|---|---|---|
| `virtual_staging` | Empty room → furnished reveal | `LIVING` / `BEDROOM` that is unfurnished | Staged image; transition clip | Nano Banana + image-to-video | AI |
| `walkthrough` | Door → living → kitchen → balcony | 3+ interior spaces | Push-in clip per photo (or real clips), joined in tour order | Image-to-video, or Video Lab smart cut for real clips | AI or REAL |
| `lifestyle_moment` | "A day in this home": tea on the balcony, kids in the living room | `BALCONY_TERRACE`, `LIVING` | Image-to-video with people prompts | Paid models do people better | AI |
| `floor_plan_3d` | Floor plan → 3D room | `FLOOR_PLAN` | Render image from the plan; push-in clip | Nano Banana + image-to-video | AI |
| `before_after` | Raw site vs finished show flat | `CONSTRUCTION_SITE` + matching finished room | Two images, wipe transition | ffmpeg (free) | REAL |

## C. Presenter-led

| id | Idea | Needs | How it's made | Tools | Label |
|---|---|---|---|---|---|
| `presenter_background` | Presenter talks over the elevation (picture-in-picture), cutaways to real clips | `EXTERIOR_ELEVATION` + presenter (real clip, or photo + consent) | Script from the brief (Gemini) → voice (Sarvam, Punjabi/Hindi) → lip-sync → overlay on a drone/elevation clip → cutaways | Free: MuseTalk / LatentSync on GPU · Paid: HeyGen, Hedra, Kling lip-sync | FACTS (+ AI if the presenter is synthetic) |
| `presenter_cutaway` | Real presenter clip with B-roll over the speech | `PRESENTER` clip with speech + other clips | Video Lab: captions from speech, B-roll by spoken keywords | Free (Gemini + ffmpeg) | REAL |
| — | "5 reasons to buy here" | Presenter + 3–5 spaces + brief `highlights` | Script per reason, presenter + B-roll per reason | As above | FACTS |
| — | Price / payment plan explainer | Brief `price`, `configurations` | Presenter + animated numbers | As above | FACTS |
| `location_explainer` | "10 min to airport, 5 min to highway" | Brief `nearbyPlaces` **with distances** | Presenter or map animation; only distances written in the brief | Free | FACTS |
| — | Buyer tips / myth vs fact (not about one project) | Nothing | Presenter only, or a cartoon explainer | Free / text-to-video | AI |

## D. From the client's real footage

| id | Idea | Needs | How it's made | Tools | Label |
|---|---|---|---|---|---|
| `construction_update` | Monthly progress update | New `CONSTRUCTION_SITE` clips this month | Best shots + captions + date stamp | Video Lab (free) | REAL |
| `testimonial` | Buyer testimonial / handover | Clip with speech of a buyer | Captions from speech, trims | Video Lab (free) | REAL |
| `behind_the_scenes` | Site visit, material quality | Site clips | Best shots + captions | Video Lab (free) | REAL |
| `hook_opening` | Real site today → AI finished render (first 2 s hook) | `CONSTRUCTION_SITE` + `EXTERIOR_ELEVATION` | Real clip, hard cut to generated clip | Mix | REAL + AI |

## E. Posts (images) and calendar

| id | Idea | Needs | How it's made | Tools | Label |
|---|---|---|---|---|---|
| `hero_post` | Single hero image + headline | Best-quality photo (`quality.score` ≥ 4), `composition.emptySpaceForText` | Headline from the brief, placed in the free space | Ideogram / our renderer | REAL or AI |
| `carousel_post` | 5–7 slides: hero, rooms, amenities, location, CTA | 4+ spaces | One slide per space | Our renderer | REAL |
| `festival_post` | Diwali lights, Lohri, Gurpurab greeting with the building | `EXTERIOR_ELEVATION` | Image edit (festive lights), optional short animation | Nano Banana | AI |
| `launch_or_urgency_post` | Launch countdown / "last N units" | Brief facts (launch date, units left) | Template + elevation | Our renderer | FACTS |
| `cover_thumbnail` | Reel cover image | Frame with `hookScore` ≥ 4 | Frame + title | ffmpeg (free) | REAL |
| — | Cartoon / animated explainer (home-loan tips, stamp duty) | Nothing | Text-to-video | Free or paid | AI |

---

## Rules for every idea

1. **Facts only from the brief.** Prices, distances, unit counts, RERA, possession date: if the brief doesn't have it, the idea doesn't use it (or isn't picked).
2. **Label AI content** "Artist's impression". Real footage and real photos stay unlabelled.
3. **People from real photos need written consent** (client presenter, buyers).
4. **No other brands.** Files whose card lists `other_brand_logo` aren't used as the hero shot.
5. **Skip weak files.** Quality score 1–2 or `keep: false` shots are not used; image-to-video only from files with `animation.imageToVideoScore` ≥ 3.

## Next steps

1. **Creative Lab (done, step 1):** every file gets a knowledge card. Admin page `/admin/creative-lab`.
2. **Planner (step 2):** given a project's cards and brief, pick this month's 4–5 videos + 6–7 posts and explain why.
3. **Generators (step 3):** one idea at a time, starting with `drone_reveal`, `construction_timelapse` and `presenter_background`, tested on one GPU machine first.
