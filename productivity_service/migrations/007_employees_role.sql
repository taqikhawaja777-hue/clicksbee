-- Distinguishes real employees (tracked in "Today, per employee", idle-time
-- summaries, and reports) from admin/manager accounts that happen to have
-- logged into the desktop app themselves (e.g. to test it) and got
-- auto-registered as if they were an employee, with no way to tell them
-- apart afterward. Defaults existing + future rows to 'EMPLOYEE' so nothing
-- already-tracked silently disappears; admin/manager rows are corrected
-- individually once identified (see the accompanying one-off backfill).
alter table employees add column if not exists role text not null default 'EMPLOYEE';
