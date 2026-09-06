-- Lets the LIVE dashboard show active/idle time "since this check-in"
-- (resetting to zero if an employee checks out and back in the same day)
-- without touching idle_time_logs' own whole-day-cumulative accumulation,
-- which reports still read directly for correct day-total figures.
-- Idempotent - safe to re-run.

alter table shift_events add column if not exists baseline_active_seconds integer;
alter table shift_events add column if not exists baseline_idle_seconds integer;
