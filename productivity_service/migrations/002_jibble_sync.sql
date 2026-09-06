-- Jibble sync: Jibble becomes the source of truth for raw time data,
-- replacing the app's own capture agent for task time tracking.
-- Idempotent - safe to re-run.

alter table employees add column if not exists jibble_member_id text unique;

alter table tasks add column if not exists jibble_activity_id text;
create index if not exists idx_tasks_jibble_activity_id on tasks(jibble_activity_id);

create table if not exists synced_time_entries (
  id uuid primary key default gen_random_uuid(),
  jibble_entry_id text unique not null, -- dedupe key for sync upserts
  task_id uuid references tasks(id),
  employee_id uuid not null references employees(id),
  activity_name text,
  entry_start timestamptz not null,
  entry_end timestamptz,
  duration_ms bigint,
  synced_at timestamptz not null default now()
);

create index if not exists idx_synced_time_entries_task_id on synced_time_entries(task_id);
create index if not exists idx_synced_time_entries_employee_id on synced_time_entries(employee_id);

-- The existing tickets table was built for the own-capture-agent flow
-- (active_ms/idle_ms/app_breakdown). Jibble-sourced tickets report a single
-- tracked_ms figure instead, so those two columns become optional and two
-- new columns are added. Old rows are untouched and keep working via a
-- fallback (tracked_ms = active_ms + idle_ms) in the service layer.
alter table tickets add column if not exists tracked_ms bigint;
alter table tickets add column if not exists source text not null default 'legacy';
alter table tickets alter column active_ms drop not null;
alter table tickets alter column idle_ms drop not null;

create table if not exists sync_state (
  key text primary key,
  last_synced_at timestamptz not null
);
