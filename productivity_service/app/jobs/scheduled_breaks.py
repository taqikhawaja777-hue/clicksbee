"""
Fires the org-wide scheduled break windows: Lunch & Zuhar (13:30-14:10) and
Tea & Asar (17:00-17:20), Asia/Karachi time, every day. Registered as four
APScheduler cron jobs in app.main (unconditionally - unlike the Jibble sync
job, this doesn't depend on any optional config).

Also triggerable on demand via POST /api/shift/dev/trigger-scheduled-break -
that endpoint calls these exact same functions, not a parallel code path,
so it's a true test of the production cron logic without waiting for the
actual clock time.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from ..db import get_supabase_client
from ..services.productivity import KARACHI_TZ, ProductivityService

logger = logging.getLogger("scheduled_breaks")

BREAK_WINDOWS = [
    {"key": "LUNCH_ZUHAR", "label": "Lunch & Zuhar", "start": "13:30", "end": "14:10"},
    {"key": "TEA_ASAR", "label": "Tea & Asar", "start": "17:00", "end": "17:20"},
]


def _karachi_today_str(now: datetime) -> str:
    return now.astimezone(KARACHI_TZ).date().isoformat()


def start_scheduled_break(break_key: str) -> dict:
    window = next(w for w in BREAK_WINDOWS if w["key"] == break_key)
    service = ProductivityService(get_supabase_client())
    now = datetime.now(timezone.utc)
    today_str = _karachi_today_str(now)

    started = []
    for employee in service.get_employees_eligible_for_scheduled_break(now):
        service.start_break(
            employee_id=UUID(employee["id"]),
            break_type=break_key,
            triggered_by="scheduled",
            label=f"{window['label']} Break",
            schedule_key=f"{today_str}:{break_key}:start",
        )
        started.append(employee["id"])

    logger.info("Scheduled break START %s for %d employee(s)", break_key, len(started))
    return {"break_key": break_key, "action": "start", "employee_ids": started}


def end_scheduled_break(break_key: str) -> dict:
    service = ProductivityService(get_supabase_client())
    now = datetime.now(timezone.utc)
    today_str = _karachi_today_str(now)

    ended = []
    for employee in service.list_employees():
        employee_id = UUID(employee["id"])
        latest = service.get_latest_shift_event(employee_id, before=now)
        # Only end a break THIS scheduler started, and only if it's still
        # the current, unmatched event - deliberately leaves a concurrent
        # manual break untouched if the scheduled end-time happens to land
        # in the middle of one.
        if (
            latest
            and latest["event_type"] == "break_start"
            and latest.get("triggered_by") == "scheduled"
            and latest.get("break_type") == break_key
        ):
            service.end_break(
                employee_id=employee_id,
                break_type=break_key,
                triggered_by="scheduled",
                schedule_key=f"{today_str}:{break_key}:end",
            )
            ended.append(employee["id"])

    logger.info("Scheduled break END %s for %d employee(s)", break_key, len(ended))
    return {"break_key": break_key, "action": "end", "employee_ids": ended}
