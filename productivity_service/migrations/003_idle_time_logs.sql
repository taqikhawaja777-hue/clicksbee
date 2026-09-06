-- Idle/active input & app-focus tracking (replaces vision-based recording
-- monitoring on the Manager Supervisor Portal). Desktop client polls system
-- idle time + active window every 15-30s and batches a daily cumulative
-- snapshot to POST /api/idle-time/log every 1-2 minutes.
-- Idempotent - safe to re-run.

create table if not exists idle_time_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  date date not null,
  active_seconds bigint not null default 0,
  idle_seconds bigint not null default 0,
  app_focus_seconds jsonb not null default '{}'::jsonb,
  total_logged_seconds bigint not null default 0,
  -- Snapshot of the client's most recent 15-30s sample, used to derive a
  -- "current status" (Active in Jabber / Active in Wildix / Idle / Away) for
  -- the live manager card without a separate real-time transport.
  last_active_app text,
  last_is_idle boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint idle_time_logs_employee_date_unique unique (employee_id, date)
);

create index if not exists idx_idle_time_logs_employee_id on idle_time_logs(employee_id);
create index if not exists idx_idle_time_logs_date on idle_time_logs(date);
