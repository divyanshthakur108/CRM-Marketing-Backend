# RealCRM Backend API

Enterprise Multi-Tenant AI Real Estate Marketing Automation + CRM Backend Service.  
Built with **Node.js, Express.js, TypeScript, Mongoose (MongoDB), Vitest, and Pino**.

---

## 1. Architectural Highlights

- **Multi-Tenant Isolation:** Complete logical tenant separation across all models, storage, jobs, and endpoints enforced via `organizationId` middleware.
- **Role-Based Access Control (RBAC):** Strict permission enforcement supporting 6 distinct roles (`org_owner`, `marketing_manager`, `creative_contributor`, `client_approver`, `sales_agent`, `viewer`).
- **Encrypted Secret Storage:** AES-256-GCM authenticated encryption for OAuth access tokens, Meta page tokens, and credentials.
- **Fair Housing Act Compliance:** Automated pre-flight policy guards preventing discriminatory targeting (age, gender, postal codes) on real estate ads.
- **Pluggable Architecture:**
  - **Meta Adapter:** `MockMetaAdapter` (default sandbox) and `RealMetaAdapter` (production Graph API v21.0).
  - **AI Provider:** `MockAIProvider` (deterministic local real estate copywriter) and `GeminiAIProvider` (Google Gemini Pro).
  - **WhatsApp Adapter:** `MockWhatsAppAdapter` (sandbox with consent enforcement and bot handoff).
- **Background Worker Engine:** Resilient MongoDB-backed job queue with heartbeat recovery, exponential backoff, and idempotent retry.
- **Comprehensive Test Suite:** 141 passing unit, API, tenant-isolation, and role matrix tests with 100% coverage of core business rules.

---

## 2. Directory Structure

```
backend/
├── src/
│   ├── app.ts                  # Express application configuration & middleware chain
│   ├── index.ts                # Server entrypoint & DB lifecycle manager
│   ├── worker.ts               # Background job queue worker runner
│   ├── config/
│   │   ├── env.ts              # Zod-validated environment schema
│   │   └── db.ts               # Mongoose MongoDB connection manager
│   ├── middleware/
│   │   ├── auth.ts             # JWT authentication & session extraction
│   │   ├── checkPermission.ts  # RBAC matrix permission gate
│   │   ├── rateLimiter.ts      # Strict production rate limiters (API & Auth)
│   │   ├── errorHandler.ts     # Global centralized error handler
│   │   └── tenantIsolation.ts  # Multi-tenant scoping assertions
│   ├── models/                 # Mongoose schema definitions (14 collections)
│   ├── modules/
│   │   ├── auth/               # Signup, login, refresh tokens, Google OAuth, invite
│   │   ├── projects/           # Real estate projects & unit inventories
│   │   ├── media/              # Media upload, EXIF sanitization, local storage
│   │   ├── brand/              # Developer brand profiles & guidelines
│   │   ├── audience/           # Audience briefs & buyer personas
│   │   ├── ai/                 # Creative generation & rendering pipeline
│   │   ├── budget/             # Monthly budget allocations & caps
│   │   ├── plan/               # 30-day marketing plans & scheduled items
│   │   ├── approvals/          # Statutory RERA checklist & sign-off workflows
│   │   ├── meta/               # Meta OAuth, campaign deployment & housing policy
│   │   ├── leads/              # Lead CRM, deduplication & webhooks
│   │   ├── analytics/          # Daily insights aggregation & timeseries
│   │   ├── whatsapp/           # Two-way messaging, consent guard & bot handoff
│   │   └── appointments/       # Site-visit slots, double-booking prevention & tasks
│   ├── queue/                  # Job queue dispatcher & worker execution
│   └── scripts/
│       ├── seed.ts             # Full enterprise database seed
│       └── e2eServer.ts        # Standalone in-memory MongoDB runner for E2E
└── tests/                      # 11 Vitest test suites (141 tests)
```

---

## 3. Environment Variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | HTTP server port | `5000` |
| `NODE_ENV` | Runtime environment (`development`, `test`, `production`) | `development` |
| `MONGODB_URI` | MongoDB connection URI | `mongodb://localhost:27017/realcrm` |
| `JWT_SECRET` | Secret key for signing access tokens | `your-secure-jwt-secret-at-least-32-chars-long` |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | `your-secure-jwt-refresh-secret-at-least-32-chars` |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| `AI_PROVIDER` | AI Copywriting adapter (`mock` or `gemini`) | `mock` |
| `GEMINI_API_KEY` | Google Gemini API key (optional if mock) | `""` |
| `META_ADAPTER` | Meta marketing adapter (`mock` or `real`) | `mock` |
| `META_APP_ID` | Meta Developer App ID | `""` |
| `META_APP_SECRET` | Meta App Secret | `""` |
| `WHATSAPP_ADAPTER` | WhatsApp adapter (`mock` or `cloud`) | `mock` |
| `CLIENT_URL` | Frontend origin for CORS whitelist | `http://localhost:5173` |

---

## 4. Setup & Running from a Fresh Clone

### 4.1 Install Dependencies
```bash
npm install
```

### 4.2 Run In-Memory E2E Server (Zero Setup Required)
To run the backend immediately without configuring external MongoDB Atlas or Redis:
```bash
npm run e2e:server
```
This launches a self-contained in-memory MongoDB database instance, seeds standard tenant workspaces (`Apex Luxury Estates` and `Zenith Commercial Partners`), and listens on `http://localhost:5000`.

### 4.3 Run with External MongoDB
1. Ensure your MongoDB instance is running and set `MONGODB_URI` in `.env`.
2. Seed the initial database:
   ```bash
   npm run seed
   ```
3. Start the development server with live reload:
   ```bash
   npm run dev
   ```
4. Start the background queue worker in a separate terminal:
   ```bash
   npm run worker
   ```

---

## 5. Running Automated Tests

Run the full Vitest suite (11 test files, 141 tests):
```bash
npm run test
```

Or run individual suites:
```bash
# Tenant isolation suite
npx vitest run tests/tenant_isolation.test.ts

# Role-based access control matrix
npx vitest run tests/role_matrix.test.ts

# Meta publishing & housing compliance
npx vitest run tests/phase12.test.ts

# Leads CRM & analytics
npx vitest run tests/phase13.test.ts

# WhatsApp & site-visit appointments
npx vitest run tests/phase14.test.ts
```

---

## 6. Seeded Test Credentials

| Email | Password | Role | Organization |
|---|---|---|---|
| `owner@apex-luxury.in` | `Password123!` | `org_owner` | Apex Luxury Estates |
| `manager@apex-luxury.in` | `Password123!` | `marketing_manager` | Apex Luxury Estates |
| `approver@apex-luxury.in` | `Password123!` | `client_approver` | Apex Luxury Estates |
| `sales@apex-luxury.in` | `Password123!` | `sales_agent` | Apex Luxury Estates |
| `viewer@apex-luxury.in` | `Password123!` | `viewer` | Apex Luxury Estates |
| `owner@zenith-commercial.in` | `Password123!` | `org_owner` | Zenith Commercial Partners |

---

## 7. Production Build & Deployment

```bash
# Type check and compile TypeScript
npm run build

# Start compiled server
npm run start
```
