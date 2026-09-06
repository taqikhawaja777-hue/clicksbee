# 🚀 StitchMonitor Pro - Employee Monitoring & Productivity Platform

Production-grade NestJS Backend and Multi-Role RBAC Frontend Dashboard Suite for Enterprise Operational Excellence.

---

## 🌟 Architecture Overview

- **Backend Stack**: NestJS 10, Prisma ORM 5 (MongoDB Provider), Redis (BullMQ / Caching), Socket.IO (Live Feeds), Argon2 / JWT Authentication.
- **Frontend Stack**: Single Page Application Router (`index.html`), Glassmorphism UI (Tailwind CSS & Material Symbols), Role-Based Screen Hierarchy (`/admin/*`, `/manager/*`, `/employee/*`).
- **Database**: MongoDB (23+ Prisma Data Models with Indexes).

---

## 🚀 Quick Start Guide

### 1. Local Development Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Generate Prisma Client
npm run prisma:generate

# Seed Database with Default Organization & Admin
npm run prisma:seed

# Build NestJS Backend
npm run build

# Start Backend Server
npm run start:dev
```

- **Web Dashboard Portal**: [http://localhost:8080](http://localhost:8080)
- **Backend API & Swagger Documentation**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## 🐳 Docker Deployment

To launch the full stack (NestJS API + MongoDB + Redis) with Docker Compose:

```bash
docker-compose up -d --build
```

---

## 🔐 Role-Based Access Control (RBAC) Hierarchy

1. **🟢 EMPLOYEE VIEW (`/employee/*`)**:
   - `Employee Dashboard`: Live Clock-In / Clock-Out widget, Task & Break Tracker.
   - `My Tasks`: Tasks assigned by supervisors.
   - `My Screenshots`: Self-audit transparency log.

2. **🟡 MANAGER VIEW (`/manager/*`)**:
   - `Manager Dashboard`: Team performance counters & active project progress.
   - `Live Monitoring`: Grid view of active employee screens.
   - `Team Directory`: Direct report activity status & contacts.
   - `Activity Timeline`: Review idle times, application/website logs.
   - `Reports`: Export productivity & attendance metrics.

3. **🔴 ADMIN VIEW (`/admin/*`)**:
   - `Admin Dashboard`: Company-wide operational overview.
   - `Live Monitoring & All Feeds`: Real-time monitoring across all teams.
   - `Employee Directory`: User governance & role assignments.
   - `Policy Editor`: Screenshot interval config (5-15m), blur mode, idle timeouts.
   - `Admin Settings`: Security config & REST Swagger documentation.
   - `Manage Licenses`: Enterprise seat allocation & subscription management.

---

## 📊 Per-Task Productivity Tracking

A feature that tracks time *per task*, computes a live productivity score,
and auto-generates a "ticket" (session summary) when a task is closed. It
runs as its own **FastAPI + Supabase (Postgres)** service — a separate
backend/database from the main NestJS + MongoDB app described above. The
React UI lives in `admin_dashboard` (nav item **"Task Productivity"**) and
never computes the score itself — it only displays what the service returns.

**Jibble is the source of truth for time data**, not this app's own capture
agent: a polling sync job pulls time entries from Jibble into Supabase, and
that's what the productivity score and tickets are computed from. (The
earlier own-capture-agent path — `POST /api/activity/events` and
`admin_dashboard/productivityCapture.ts` — still exists and still runs, but
nothing scores off it anymore now that Jibble has taken over; see the note
at the end of this section.)

### 1. Provision Supabase and run the migrations

Create a Supabase project (or point at any Postgres 14+ instance), then run,
in order:

```bash
psql "$DATABASE_URL" -f productivity_service/migrations/001_create_productivity_tables.sql
psql "$DATABASE_URL" -f productivity_service/migrations/002_jibble_sync.sql
psql "$DATABASE_URL" -f productivity_service/migrations/003_idle_time_logs.sql
psql "$DATABASE_URL" -f productivity_service/migrations/004_camera_presence.sql
```

Migration 001 creates `employees`, `tasks`, `activity_events`, and
`tickets`. Migration 002 (idempotent, `if not exists` throughout) adds
`employees.jibble_member_id`, `tasks.jibble_activity_id`, the
`synced_time_entries` and `sync_state` tables, and `tracked_ms`/`source`
columns on `tickets`. Migration 003 (also idempotent) adds
`idle_time_logs`, one row per employee per day, upserted by the desktop
app's whole-day idle/active tracker. This service owns its own minimal
`employees`/`tasks` tables — it does not read from the main app's MongoDB
`User`/`Task` collections.

### 2. Get Jibble API credentials

In Jibble: **Organization Settings → API Keys → Create New Secret**. Copy
the API Key ID and Secret immediately (the secret is shown once).

> The exact Jibble resource paths/field names used by
> `app/services/jibble_client.py` are a best-effort reconstruction (the
> token endpoint and API hosts are verified; `docs.api.jibble.io` itself is
> a JS-rendered page this environment couldn't crawl to confirm the rest).
> If sync logs show 404s or empty results, check that page against a live
> test call and adjust the path/field-name constants at the top of that
> file — everything Jibble-related is centralized there.

### 3. Run the FastAPI service

```bash
cd productivity_service
python -m venv .venv && .venv\Scripts\activate   # or `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt

cp .env.example .env
# edit .env: SUPABASE_URL, SUPABASE_KEY, JIBBLE_CLIENT_ID, JIBBLE_CLIENT_SECRET
# (JIBBLE_ORGANIZATION_ID only if your Jibble endpoints are org-scoped)

uvicorn app.main:app --reload --port 8000
```

- **API base URL**: `http://localhost:8000`
- **Interactive docs**: `http://localhost:8000/docs`
- If `JIBBLE_CLIENT_ID`/`JIBBLE_CLIENT_SECRET` are set, a background sync
  runs automatically every `JIBBLE_SYNC_INTERVAL_MINUTES` (default 5). If
  they're unset, the app still runs fine — the scheduler just doesn't start
  (logged at startup).
- **Run tests**: `pytest` (from `productivity_service/`) — covers the
  productivity formula's edge cases (zero tracked time, estimate-based vs.
  time-on-task-ratio fallback, overrun capped at 100%), the close-task flow
  against synced time entries, and sync-job idempotency (re-running the
  same entry doesn't duplicate rows) — all against a fake in-memory
  Supabase client, so no live database or Jibble account is needed to run
  the suite.

### 4. Run or trigger the sync manually (for testing)

One-shot, from the command line:

```bash
cd productivity_service
python -m app.jobs.sync_jibble
```

Or while the server is running, via HTTP:

```bash
curl -X POST http://localhost:8000/api/sync/jibble
```

Both run the identical sync and return/print a summary (`pulled`,
`upserted`, `tasksCreated`, `skipped`). Re-running it is always safe —
entries are deduplicated on `jibble_entry_id`.

### 5. Point the frontend at it

The React client defaults to `http://localhost:8000`. To override, add to
`admin_dashboard/.env`:

```
VITE_PRODUCTIVITY_API_URL=http://localhost:8000
```

Then in the app, open **Task Productivity** in the sidebar. The "Currently
Working" list and ticket history reflect whatever the last Jibble sync
pulled in. The "Task Session" panel's **Register Employee** step is where
you set `jibbleMemberId` so sync can match time entries to that employee —
without it, Jibble entries for that person have nowhere to land.

### 6. Idle/active input tracking (Cisco Jabber / Wildix)

Replaces the old screen-recording-based monitoring on the Manager
Supervisor Portal. The Electron main-process tracker
(`admin_dashboard/idleTimeTracker.ts`) starts automatically on login,
polling `powerMonitor.getSystemIdleTime()` and the active window
(`active-win`) every 15-30s, and batches a cumulative daily snapshot to
`POST /api/idle-time/log` every 1-2 minutes. Endpoints:

- `POST /api/idle-time/log` — upserts the caller's `(employeeId, date)` row
  with the day's running totals so far (not a delta).
- `GET /api/idle-time/{employeeId}?startDate=...&endDate=...` — per-day
  history for the "Idle Time" sidebar page.
- `GET /api/idle-time/summary` — today's per-employee status
  (`ACTIVE_JABBER` / `ACTIVE_WILDIX` / `ACTIVE` / `IDLE` / `AWAY`), polled
  every 20s to drive the "Live Idle/Active Status" card on the Manager
  Supervisor Portal overview.

**Known limitation**: neither Cisco Jabber's nor Wildix's call-status API
is wired up (`checkOnCallStatus` in `idleTimeTracker.ts` is a stub that
always returns `false`) — verifying the real integration needs a live
install of each app, which wasn't available while building this. Until
that's wired in, an employee idle at the keyboard during a call in either
app still accumulates idle time rather than being counted as active. The
Jabber/Wildix process-name signatures in that same file are also
best-effort and worth re-checking against a real install.

### 7. Camera-based presence detection (optional, consent-gated)

Combines webcam presence with the idle/active input tracking above into
one signal — an employee is only ever counted idle if they're both away
from the camera *and* not touching the mouse/keyboard. This is entirely
separate from, and additive to, idle-time tracking: `idle_time_logs` is
untouched, and this feature can be off (the default) with zero effect on
anything else in the app.

**Privacy/legal**: this touches camera hardware and face detection.
Several jurisdictions (Illinois' BIPA, GDPR in the EU, works-council rules
in Germany/France, and others) regulate camera-based employee monitoring
specifically, even when — as built here — no image is ever stored and no
facial *recognition*/identification happens, only a boolean "is a face
present" check. Get this reviewed by counsel before enabling it for real
employees.

**How it works**: runs entirely client-side in the Electron renderer
(`admin_dashboard/src/services/presenceDetector.ts`), using face-api.js's
TinyFaceDetector model (weights bundled at
`admin_dashboard/public/models/`, ~190KB, fetched from the face-api.js
project's own repo — no OpenCV/Python involved, despite earlier framing of
this feature; see the option chosen when this was scoped). Every 15-30s it
briefly acquires the webcam, grabs one frame onto an in-memory `<canvas>`,
runs detection, and immediately releases the camera and discards the
frame — nothing is saved or transmitted beyond `{faceDetected,
mouseKeyboardActive, combinedStatus}` and a timestamp. `mouseKeyboardActive`
comes from the same `powerMonitor.getSystemIdleTime()` threshold
`idleTimeTracker.ts` already uses, read via a new `get-system-idle-seconds`
IPC call (added because `powerMonitor` only exists in the main process, not
the renderer).

**Consent & enablement** (migration `004_camera_presence.sql`):
- Off by default, both globally (`presence_config` singleton row) and per
  employee (`employees.camera_monitoring_enabled`) — both must be true for
  the feature to activate for someone. No team-level grouping: this
  service has no concept of teams (only the main NestJS app does).
- The desktop app checks `GET /api/presence/config/{employeeId}` on
  login; if effectively enabled and no consent decision exists yet, it
  shows `CameraConsentModal.tsx` (separate from the base `ConsentModal`)
  before ever touching the camera. Every consent decision — accept *or*
  decline — is logged to `camera_consent_log`, and `POST /api/presence/log`
  independently re-checks for active consent server-side and rejects with
  403 if none exists, so a modified client can't bypass the UI gate.
- Manager-only toggles live in **Settings → Camera Presence Monitoring**
  (global switch + a per-employee list).

**Endpoints**: `POST /api/presence/consent`, `GET
/api/presence/consent/{employeeId}`, `GET|PUT /api/presence/config/global`,
`GET|PUT /api/presence/config/{employeeId}`, `POST /api/presence/log`, `GET
/api/presence/summary/{employeeId}?date=...` (the last one drives the
"Presence Verification" stat cards on the Idle Time page: camera-confirmed,
input-confirmed, combined, and idle/away time).

**Not verified end-to-end**: no browser/Electron runtime or webcam was
available while building this. What *was* verified: the backend consent
gating, config toggles, and summary aggregation (against a fake Supabase
client, since no real Supabase project is configured in this environment
either — see the FastAPI + Supabase migration steps above), that
`tsc --noEmit` passes for every changed file, that Vite bundles face-api.js
and resolves the model files without error, and that all new endpoints
register correctly. What was *not* run even once: `faceapi.detectSingleFace`
against an actual video frame, and the full consent → capture → log flow
inside a live Electron window. Both need manual testing on your machine
with a real webcam.

### Note: two time-tracking paths currently coexist

This service still has its original own-capture-agent ingestion path
(`POST /api/activity/events`, fed by `admin_dashboard/productivityCapture.ts`
in the Electron main process) alongside the new Jibble sync. Both still run,
but only Jibble-sourced `synced_time_entries` feed the score/ticket
endpoints now. If Jibble is meant to fully replace the own-capture agent
going forward, the old ingestion endpoint and Electron module are safe to
remove — that wasn't done automatically since it's still-working code and
removing it wasn't explicitly requested.
