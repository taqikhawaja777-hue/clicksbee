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
from datetime import datetime, timedelta, timezone
from uuid import UUID

from ..db import get_supabase_client
from ..services.productivity import ProductivityService, _parse_iso, shift_day
from ..services.notify_client import notify_system_event

logger = logging.getLogger("scheduled_breaks")

BREAK_WINDOWS = [
    {"key": "LUNCH_ZUHAR", "label": "Lunch & Zuhar", "start": "13:30", "end": "14:10"},
    {"key": "TEA_ASAR", "label": "Tea & Asar", "start": "17:00", "end": "17:20"},
]


def _karachi_today_str(now: datetime) -> str:
    return shift_day(now).isoformat()


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


def check_late_returns(break_key: str) -> dict:
    """Runs GRACE_PERIOD_SECONDS after a scheduled break's own end-time cron
    (registered in app.main's start_scheduler alongside the start/end jobs
    for the same window). For each employee whose LATEST shift event is
    still that exact scheduled break_end (i.e. they haven't started
    another break or checked out since - either is a legitimate reason to
    skip this check, not a violation), checks whether any presence_logs
    row landed in [break_end, break_end + grace] showing confirmed-active
    status. Reuses ProductivityService._compute_compliance_score() - the
    SAME check that formula uses for its late-return penalty - rather than
    re-implementing the "is this a late return" logic a second time."""
    service = ProductivityService(get_supabase_client())
    config = service.get_productivity_config()
    grace_seconds = config["break_grace_period_seconds"]
    now = datetime.now(timezone.utc)

    notified = []
    for employee in service.list_employees():
        employee_id = UUID(employee["id"])
        latest = service.get_latest_shift_event(employee_id, before=now)
        if not (
            latest
            and latest["event_type"] == "break_end"
            and latest.get("triggered_by") == "scheduled"
            and latest.get("break_type") == break_key
        ):
            continue

        break_end_at = _parse_iso(latest["occurred_at"])
        window_end = break_end_at + timedelta(seconds=grace_seconds)
        presence_rows = (
            service.client.table("presence_logs")
            .select("*")
            .eq("employee_id", str(employee_id))
            .gte("occurred_at", break_end_at.isoformat())
            .lte("occurred_at", window_end.isoformat())
            .execute()
        ).data or []

        _, breakdown = ProductivityService._compute_compliance_score(0, [latest], presence_rows, config)
        if breakdown["lateReturnCount"] > 0:
            window_label = next((w["label"] for w in BREAK_WINDOWS if w["key"] == break_key), break_key)
            notify_system_event(
                employee_email=employee.get("email"),
                notification_type="LATE_BREAK_RETURN",
                admin_title="Late Return From Break",
                admin_message=f"{employee.get('full_name')} has not returned from their {window_label} break {grace_seconds // 60}+ minutes after it ended",
            )
            notified.append(employee["id"])

    if notified:
        logger.info("Late-return check for %s: notified %d employee(s)", break_key, len(notified))
    return {"break_key": break_key, "action": "check_late_returns", "employee_ids": notified}
