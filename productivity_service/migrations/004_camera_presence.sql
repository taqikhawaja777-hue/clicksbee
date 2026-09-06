-- Camera-based presence detection: consent, per-employee/global enablement,
-- and raw presence check-ins. Kept entirely separate from idle_time_logs
-- (migration 003) so camera-derived data stays independently queryable and
-- purgeable if a team later opts out - idle_time_logs itself is untouched.
-- Idempotent - safe to re-run.

alter table employees add column if not exists camera_monitoring_enabled boolean not null default false;

-- Singleton row: the global kill switch. Effective enablement for an
-- employee is (presence_config.globally_enabled AND
-- employees.camera_monitoring_enabled) - either one being off disables the
-- feature for that employee, per the "per-employee or globally" spec.
create table if not exists presence_config (
  id integer primary key default 1,
  globally_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint presence_config_singleton check (id = 1)
);
insert into presence_config (id, globally_enabled)
  values (1, false)
  on conflict (id) do nothing;

-- One row per consent decision (accept or decline) - an audit trail, not
-- just a single yes/no flag, so there's a record of what was disclosed and
-- when even if the employee later changes their answer.
create table if not exists camera_consent_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  consented boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_camera_consent_log_employee_id on camera_consent_log(employee_id);

-- Raw per-check presence events (one row per 15-30s client-side check,
-- mirroring activity_events' raw-event shape). combined_status is computed
-- client-side at capture time (face_detected OR mouse/keyboard active in
-- that same interval), not derived here, since only the client knows both
-- signals for that exact instant. No image/frame data has a column here by
-- design - it is never sent to this service in the first place.
create table if not exists presence_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  occurred_at timestamptz not null,
  face_detected boolean not null,
  mouse_keyboard_active boolean not null,
  combined_status text not null
    constraint presence_logs_status_check check (combined_status in ('active', 'idle', 'away')),
  created_at timestamptz not null default now()
);
create index if not exists idx_presence_logs_employee_id on presence_logs(employee_id);
create index if not exists idx_presence_logs_occurred_at on presence_logs(occurred_at);
