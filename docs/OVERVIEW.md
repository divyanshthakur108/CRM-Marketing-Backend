# RealCRM — Project Overview

AI-powered real estate **marketing automation + CRM** SaaS for Indian developers and agencies.
Multi-tenant: each agency is an *organization*, users join through *memberships* with a role.

```
realestate/
├── CRM-Marketing-Backend/    Node 22 · Express 4 · TypeScript · Mongoose 8 (MongoDB)
└── CRM-Marketing-Frontend/   React 18 · Vite 6 · TypeScript · Tailwind · TanStack Query · Zustand
```

**Docs** (in `CRM-Marketing-Backend/docs/`; this overview is also copied to `CRM-Marketing-Frontend/docs/`):

| File | What |
|---|---|
| `OVERVIEW.md` | This file: how to run it, architecture, modules |
| `VIDEO_LAB.md` | What the Video Lab does today: captions from speech, clip understanding, smart cut, ffmpeg render |
| `VIDEO_PIPELINE_PLAN.md` | Next steps for video, step by step, with tech/APIs and flow charts |
| `AI_GENERATION_RESEARCH.md` | Product flow, AI providers, prices, open questions |

---

## 1. Run it locally

**Requirements:** Node 22+ and MongoDB (local `127.0.0.1:27017`, or Atlas via `MONGODB_URI`).
For video features (Video Lab, reels, thumbnails) you also need ffmpeg: use **Docker** (same build on every OS, recommended) or a local install. See [Video tools](#video-tools-ffmpeg-docker-or-local) below.

### Backend
```bash
cd CRM-Marketing-Backend
npm install
cp .env.example .env          # then edit (see notes below)
npm run seed:admin            # creates the platform admin (no demo data is seeded)
npm run dev                   # API on http://localhost:$PORT  (health: /api/v1/health)
```

### Frontend
```bash
cd CRM-Marketing-Frontend
npm install
API_PROXY_TARGET=http://127.0.0.1:5050 npm run dev    # http://localhost:5173
```
The frontend calls `/api/v1/...` relatively; Vite proxies `/api` and `/storage` to the backend.
`API_PROXY_TARGET` defaults to `http://127.0.0.1:5000`.

On Windows (PowerShell) set the variable first: `$env:API_PROXY_TARGET="http://127.0.0.1:5050"; npm run dev`.

### Video tools: ffmpeg (Docker or local)
Only the video tools run in Docker. Node, MongoDB and the frontend run on your machine as usual.

**Option A: Docker (recommended, any OS).** Needs Docker Desktop.
```bash
cd CRM-Marketing-Backend
docker compose up -d media-tools     # first time builds the image (~1 min), then starts it
```
Then set `MEDIA_TOOLS=docker` in the backend `.env` and restart the backend. The backend runs ffmpeg/ffprobe inside the
`realcrm-media-tools` container (`docker exec`), with the backend folder mounted at `/work`.
The image is Debian's ffmpeg 7.1 with libass + HarfBuzz (Hindi/Punjabi captions), vidstab, x264 and fonts.
Files: `docker-compose.yml`, `docker/media-tools/Dockerfile`, `src/utils/ffmpeg.ts`.

**Option B: local ffmpeg.** Leave `MEDIA_TOOLS` empty and set `FFMPEG_PATH` to a build **with libass**:
- macOS: `brew install ffmpeg-full`, then `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
- Windows: a "full" build (e.g. gyan.dev), then `FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe`
- Linux: distro `ffmpeg` package (usually includes libass)

Rules for new code that runs ffmpeg: use `runFfmpeg` / `spawnFfmpeg` / `spawnFfprobe` / `probeMedia` from
`src/utils/ffmpeg.ts` (never `spawn('ffmpeg')` directly), and keep every input/output file **inside the backend folder**
(e.g. `storage/scratch/`), because the container can only see that folder.

### Local setup notes
| Issue | Fix |
|---|---|
| macOS: port **5000** is taken by AirPlay Receiver | Set `PORT=5050` in backend `.env` and run the frontend with `API_PROXY_TARGET=http://127.0.0.1:5050` |
| No `GEMINI_API_KEY` | AI features return a clear `AI_NOT_CONFIGURED` error. There is no fake/mock AI mode. Set `AI_PROVIDER=none` to switch AI off. |
| `MEDIA_TOOLS=docker` but "No such container" | Run `docker compose up -d media-tools` in `CRM-Marketing-Backend` |
| Zero-setup alternative | `npm run e2e:server` — in-memory MongoDB with test data, for Playwright E2E tests only |

### Accounts
Only the platform admin exists, from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in the backend `.env` (`npm run seed:admin`).
Organizations and users are created through signup or admin onboarding. The old demo seed script was removed.

---

## 2. Backend architecture

```
src/
├── index.ts          Bootstrap: connect DB → init indexes → start scheduler + worker loop → listen
├── app.ts            Express app: requestId → pino logs → helmet → CORS → cookies → JSON → rate limit → routers
├── worker.ts         Job processor (also runnable standalone via `npm run worker`)
├── config/           env (zod-validated), db, logger, permissions (RBAC matrix), onboarding steps
├── middleware/       authenticate (JWT), resolveTenant (x-organization-id), authorize (permission), validate (zod)
├── models/           28 Mongoose models (all tenant data keyed by organizationId)
├── modules/          Feature modules: routes → controller → service → validation
├── queue/            MongoDB-backed job queue (claim, heartbeat, retry with backoff)
├── scheduler/        node-cron daily "rolling scheduler"
├── services/         email (nodemailer), gemini
├── storage/          Storage adapter: Cloudinary when configured, else local disk (./storage)
└── scripts/          seedAdmin (platform admin), e2eServer (in-memory DB for Playwright tests)
```

### Request pipeline
`authenticate` (Bearer access token) → `resolveTenant` (reads `x-organization-id`, checks membership) → `authorize('perm:x')` → zod `validate` → controller → service. Errors go through a central `errorHandler` using `AppError`.

### Auth
- JWT access token (15m) + refresh token (7d, stored in `RefreshToken` model, rotated).
- Frontend axios interceptor attaches the token + org header and transparently refreshes on 401.
- Passwords hashed with bcrypt; Meta/OAuth tokens encrypted with AES-256-GCM (`utils/crypto.ts`).

### Roles
`platform_admin`, `org_owner`, `marketing_manager`, `creative_contributor`, `client_approver`, `sales_agent`, `viewer` — mapped to permissions in `config/permissions.ts` (e.g. `projects:create`, `campaigns:publish`, `leads:write`).

### API modules (`/api/v1/...`)
| Mount | Purpose |
|---|---|
| `/health` | Liveness + DB status |
| `/auth` | Signup, login, refresh, logout, forgot/reset password, invitations |
| `/onboarding` | Step-by-step org onboarding |
| `/admin/organizations` | Platform admin: manage tenant orgs |
| `/projects` | Real estate projects + property units (RERA info, pricing, amenities) |
| `/media` | Upload with magic-byte checks, thumbnails (sharp), range-streamed video |
| `/brand`, `/audience-briefs`, `/budgets` | Brand profile, buyer personas, monthly budget caps |
| `/plans`, `/plan-items` | 30-day marketing calendar and its items |
| `/approvals` | Client/RERA approval queue |
| `/ai` | AI Studio: captions, creatives, posters, image sets, reels, presenter walkthroughs, voiceovers, occasion posts |
| `/meta`, `/publishing`, `/campaigns` | Meta (Facebook/Instagram) connection, organic posts, paid ads |
| `/leads` | Lead CRM pipeline (kanban stages, activities, dedupe) |
| `/conversations` | WhatsApp concierge (bot + agent handoff, consent) |
| `/appointments` | Site-visit booking with double-booking protection |
| `/analytics` | Spend, impressions, CPL, CTR, funnel |
| `/notifications` | In-app notifications |
| `/webhooks` | Meta lead-ads + WhatsApp inbound webhooks |

### AI (Gemini): no fake output
AI requests never return placeholder or template output. When Gemini is unavailable the request
fails with a clear error the UI shows: `AI_NOT_CONFIGURED`, `AI_QUOTA_EXCEEDED` (billing not enabled),
`AI_KEY_INVALID`, `AI_MODEL_UNAVAILABLE`, `AI_SAFETY_BLOCKED`, `AI_TIMEOUT`.

Settings: `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL` (default `gemini-3.5-flash`), `GEMINI_IMAGE_MODEL`,
`GEMINI_VIDEO_MODEL`; `AI_PROVIDER=none` turns AI off. Prompts get only the project's real facts.
Tests use a fake from `tests/fakes/`, wired in `tests/setup.ts`; the app itself has none.

### Other integrations (unchanged for now)
| Concern | Env var | Options |
|---|---|---|
| Meta | `META_ADAPTER` | `mock` (default), `meta` (Graph API) |
| WhatsApp | — | mock adapter only |

### Core automation flow
```
Plan (30-day calendar) ──approve──▶ PlanItems APPROVED
        │
  rollingScheduler (daily cron): items due within GENERATION_LEAD_DAYS (7)
        │ enqueue
        ▼
  Job queue (Mongo) ──▶ worker: GENERATE_CREATIVE / GENERATE_CREATIVE_SET
        │                      PUBLISH_ORGANIC / PUBLISH_PAID_AD
        ▼
  Creative (poster/caption) → approval → publish to Meta (housing-policy checks)
        ▼
  Lead webhooks → Leads CRM → WhatsApp bot → Appointment (site visit)
```
The worker loop runs inside the API process in dev, so `npm run worker` is only needed for a separate worker.

### Video Lab (admin testing: video editing, Step 1)
Full details: `VIDEO_LAB.md`.
Admin Console → **Video Lab** (`/admin/video-lab`, platform admin only). Upload raw clips, an optional logo and music, type the
org/project details and caption lines, and generate 1–3 variants. Each render shows its steps and ffmpeg commands.
No organization or project is needed. Code: `src/modules/videolab/` (recipe → ffmpeg renderer → Cloudinary), API `/api/v1/admin/video-lab`.

- Needs an ffmpeg build with **libass + HarfBuzz** for Hindi/Punjabi captions. On macOS: `brew install ffmpeg-full`, then
  `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` in the backend `.env`. If the binary fails with a `libhvf.dylib` error,
  run `brew reinstall --build-from-source freetype`.
- Fonts (Noto Sans, Noto Sans Devanagari, Noto Sans Gurmukhi; OFL) are bundled in `assets/fonts/`.
- **Captions from speech** (default): `POST /admin/video-lab/transcribe` extracts each clip's audio with ffmpeg and asks
  Gemini (`GEMINI_TEXT_MODEL`, audio input) for short timed captions in the chosen script (Hindi → Devanagari,
  Punjabi → Gurmukhi, Hinglish → Roman, English → translated if needed). Cues are stored per clip, so they stay in sync
  when a variant reorders clips. They are shifted onto the merged timeline (minus crossfades) at render time.
  The admin can edit the text before generating. Typed lines (spread evenly) are still available.

### File storage (Cloudinary)
Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (and optional `CLOUDINARY_FOLDER`, default `realcrm`).
- Every file is written to a local working folder first (sharp/ffmpeg need real files), then uploaded to Cloudinary.
- Records store Cloudinary URLs. Older `/storage/<key>` and `/api/v1/media/.../file` links redirect to Cloudinary.
- Reading a file that isn't on this machine downloads it from Cloudinary, so any machine/server can process it.
- If any Cloudinary variable is empty (and always in tests), files stay on local disk only.

### Tests
Vitest + supertest + mongodb-memory-server, in `tests/` (tenant isolation, role matrix, phases 9–14, AI studio, media, posters).
```bash
npm test
```

---

## 3. Frontend architecture

```
src/
├── App.tsx           Routes (lazy-loaded pages) + QueryClient + Toast provider
├── lib/api.ts        axios instance (baseURL /api/v1), token + org header, refresh queue
├── store/            useAuthStore (zustand): user, accessToken, session restore
├── routes/           ProtectedRoute, OnboardingRoute, AdminRoute guards
├── hooks/            TanStack Query hooks per module (useProjects, useLeads, useAiStudio, …)
├── layouts/          AppShell (sidebar + header), AuthLayout
├── components/ui/    Design system: Button, Card, Modal, Select, Tabs, Badge, Toast, …
├── pages/            ~30 screens (below)
└── mocks/            Static mock data used by some screens
```

**Route guards:** not logged in → `/login`; onboarding incomplete → `/onboarding`; platform admins → `/admin/organizations`.

| Area | Routes |
|---|---|
| Auth | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite/:token` |
| Workspace | `/dashboard`, `/dashboard/analytics` |
| Inventory | `/projects`, `/projects/new`, `/projects/:id` |
| Content | `/assets` (media), `/studio` (AI creative studio), `/captions`, `/branding`, `/audience` |
| Planning | `/calendar`, `/plan-review`, `/approvals`, `/budget` |
| Distribution | `/connections` (Meta), `/publishing`, `/campaigns` |
| Sales | `/leads`, `/conversations`, `/appointments` |
| Admin | `/team`, `/notifications`, `/settings`, `/admin/organizations` |

Styling is a strict monochrome Tailwind design (Inter font, lucide icons). E2E tests use Playwright (`e2e/`).

---

## 4. Known issues found during setup

1. **Missing `src/storage/` folder (fixed, now Cloudinary-backed).** The backend `.gitignore` had `storage/`, which also ignored the source folder `src/storage/`, so `localStorage.adapter.ts` was never committed and the server crashed at startup. The adapter was rebuilt from how the code uses it, and `.gitignore` now ignores only the root `/storage/` (uploads) and `/storage-test/`. `src/storage/` is now committed.
2. `vite.config.js` (a compiled copy) sits next to `vite.config.ts`. Vite loads the `.js` one first, so edits to the `.ts` file alone have no effect. Both were updated; consider deleting the `.js`/`.d.ts` copies.
3. One failing test: `showcase_poster.test.ts` › "wraps very long project names into 2 lines" (gets 3 lines). Unrelated to setup.
4. Video tools differ per OS. Fixed with the Docker `media-tools` container (see "Video tools" above).
5. READMEs reference `backend/`/`frontend/` folder names; the actual folders are `CRM-Marketing-Backend`/`CRM-Marketing-Frontend`.
