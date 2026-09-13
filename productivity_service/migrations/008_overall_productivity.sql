-- Unified "Overall Productivity" scoring: a single configurable-weight
-- formula (Attendance Ratio + App Focus Score + Compliance Score) that
-- replaces every ad-hoc productivity percentage previously computed
-- independently in get_shift_summary(), _compute_daily_report_row(), and
-- the frontend's EmployeeContext.tsx. See ProductivityService's
-- "overall productivity" section for the calculation itself.
-- Idempotent - safe to re-run.

-- Allow a washroom break type - the compliance formula's "washroom breaks
-- exceeding 3/day or 4 minutes each" rule needs a way to distinguish these
-- from a generic MANUAL break. No UI wires this up yet (no "Washroom
-- Break" button exists), so this penalty component simply never fires
-- until that's built - the formula itself is real and ready for it.
alter table shift_events drop constraint if exists shift_events_break_type_check;
alter table shift_events add constraint shift_events_break_type_check
  check (break_type in ('LUNCH_ZUHAR', 'TEA_ASAR', 'MANUAL', 'WASHROOM'));

-- Singleton row (same pattern as presence_config) holding every tunable
-- number the Overall Productivity formula uses, so adjusting them is a
-- data change, not a code change/redeploy. call_efficiency_weight is
-- reserved for a future 4th sub-score (call log/talk time integration,
-- not built yet) - it defaults to 0 and is simply not applied until a
-- get_call_efficiency_score()-style component exists to pair with it.
create table if not exists productivity_config (
  id integer primary key default 1,

  -- Overall Productivity = attendance*W1 + app_focus*W2 + compliance*W3
  -- (+ call_efficiency*W4 once that integration exists). Weights are
  -- percentages of the final 0-100 score, not required to sum to exactly
  -- 100 (a component that doesn't exist yet, like call_efficiency today,
  -- simply contributes nothing rather than the others being renormalized
  -- to fill the gap - see _weighted_combine()'s docstring).
  attendance_weight numeric not null default 40,
  app_focus_weight numeric not null default 30,
  compliance_weight numeric not null default 30,
  call_efficiency_weight numeric not null default 0,

  -- Compliance: idle-time penalty. idle_seconds beyond this threshold
  -- costs idle_penalty_points_per_minute points per minute over, capped
  -- at idle_penalty_max_points total.
  idle_penalty_threshold_seconds integer not null default 1800,
  idle_penalty_points_per_minute numeric not null default 1,
  idle_penalty_max_points numeric not null default 40,

  -- Compliance: late-return-from-scheduled-break penalty. A scheduled
  -- break_end with no confirmed-active presence check within this many
  -- seconds afterward costs late_return_penalty_points, per occurrence.
  break_grace_period_seconds integer not null default 120,
  late_return_penalty_points numeric not null default 10,

  -- Compliance: washroom break limits. Exceeding the daily count, or any
  -- single washroom break exceeding the per-break minute limit, each cost
  -- washroom_penalty_points per violation.
  washroom_daily_limit integer not null default 3,
  washroom_minutes_limit numeric not null default 4,
  washroom_penalty_points numeric not null default 5,

  updated_at timestamptz not null default now(),
  constraint productivity_config_singleton check (id = 1)
);
insert into productivity_config (id) values (1) on conflict (id) do nothing;
