-- Productivity tracking feature: employees, tasks, activity_events, tickets
-- Run against the Supabase Postgres project for this service (separate from
-- the main app's MongoDB database).

create extension if not exists pgcrypto;

-- Minimal employees table. This service owns its own employee records;
-- it does not read from the main app's user store.
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  title text not null,
  status text not null default 'in_progress'
    constraint tasks_status_check check (status in ('in_progress', 'completed')),
  estimated_minutes integer,
  created_at timestamptz not null default now()
);

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  employee_id uuid not null references employees(id),
  app_name text,
  is_idle boolean not null default false,
  event_start timestamptz not null,
  event_end timestamptz not null,
  duration_ms integer not null,
  created_at timestamptz not null default now(),
  constraint activity_events_valid_range check (event_end > event_start)
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  employee_id uuid not null references employees(id),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  active_ms bigint not null,
  idle_ms bigint not null,
  productivity_score numeric(5,2) not null,
  app_breakdown jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_employee_id on tasks(employee_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_activity_events_task_id on activity_events(task_id);
create index if not exists idx_activity_events_employee_id on activity_events(employee_id);
create index if not exists idx_tickets_task_id on tickets(task_id);
create index if not exists idx_tickets_employee_id on tickets(employee_id);
create index if not exists idx_tickets_created_at on tickets(created_at);
