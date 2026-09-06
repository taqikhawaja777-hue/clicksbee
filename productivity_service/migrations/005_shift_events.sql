-- Authoritative append-only event log for check-in/check-out/break
-- boundaries. This is the single source of truth the unified shift/break
-- calculation (get_shift_summary) reconstructs a session from - idle_time_logs
-- (migration 003) and presence_logs (migration 004) are untouched and keep
-- being written exactly as before; this table is purely additive.
-- Idempotent - safe to re-run.

create table if not exists shift_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  event_type text not null
    constraint shift_events_type_check check (event_type in ('check_in', 'check_out', 'break_start', 'break_end')),
  occurred_at timestamptz not null default now(),
  -- null for check_in/check_out rows; one of these for break_start/break_end.
  break_type text
    constraint shift_events_break_type_check check (break_type in ('LUNCH_ZUHAR', 'TEA_ASAR', 'MANUAL')),
  triggered_by text not null default 'manual'
    constraint shift_events_triggered_by_check check (triggered_by in ('manual', 'scheduled')),
  label text,
  -- Idempotency key for scheduler-inserted rows only, e.g.
  -- '2026-09-06:LUNCH_ZUHAR:start' - lets a misfire re-run or process
  -- restart upsert onto the same row instead of duplicating it. Left null
  -- for manual/check_in/check_out rows (Postgres treats NULLs as distinct,
  -- so those never collide on the unique constraint below).
  schedule_key text,
  created_at timestamptz not null default now(),
  constraint shift_events_schedule_key_unique unique (employee_id, schedule_key)
);

create index if not exists idx_shift_events_employee_id on shift_events(employee_id);
create index if not exists idx_shift_events_employee_occurred on shift_events(employee_id, occurred_at desc);
create index if not exists idx_shift_events_occurred_at on shift_events(occurred_at);
