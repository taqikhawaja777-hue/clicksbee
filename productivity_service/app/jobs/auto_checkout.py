"""
Auto-checks-out anyone still checked in (or on a break) when the shift
ends (19:00 Asia/Karachi) - an employee who forgets to check out, or
whose app crashes/loses connectivity before they do, would otherwise
stay "checked in" forever, corrupting every attendance/productivity
calculation that reads shift_events for later days. Registered as a
single APScheduler cron job in app.main (unconditional, same as the
scheduled-break jobs).

Also triggerable on demand via POST /api/shift/dev/trigger-auto-checkout
for testing - that endpoint calls this exact same function, not a
parallel code path, so it's a true test of the production cron logic
without waiting for the actual clock time.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from ..db import get_supabase_client
from ..services.productivity import ProductivityService, shift_day
from ..services.notify_client import notify_system_event

logger = logging.getLogger("auto_checkout")


def auto_checkout_at_shift_end() -> dict:
    service = ProductivityService(get_supabase_client())
    now = datetime.now(timezone.utc)

    checked_out = []
    for employee in service.list_employees():
        employee_id = UUID(employee["id"])
        latest = service.get_latest_shift_event(employee_id, before=now)
        # "Still on the clock" at shift end - checked in, or on a break
        # that was never ended (a break_start/break_end both mean they
        # haven't checked out). None (never checked in today) or
        # check_out (already done, manually or by an earlier run of this
        # same job) are both correctly skipped.
        if not (latest and latest["event_type"] in ("check_in", "break_start", "break_end")):
            continue

        service.log_check_out(employee_id, occurred_at=now)
        checked_out.append(employee["id"])

        employee_email = employee.get("email")
        if not employee_email:
            continue
        summary = service.get_shift_summary(employee_id, shift_day(now))
        total_seconds = summary.get("shift_duration_seconds", 0)
        hours, minutes = divmod(total_seconds // 60, 60)
        duration_str = f"{hours}h {minutes}m"
        notify_system_event(
            employee_email=employee_email,
            notification_type="CHECK_OUT",
            admin_title="Employee Auto Checked-Out (Shift End)",
            admin_message=f"{employee.get('full_name')} was automatically checked out at shift end — Total hours: {duration_str}",
            employee_title="Shift Ended — Checked Out",
            employee_message=f"Your shift ended and you were automatically checked out — Total hours today: {duration_str}",
        )

    if checked_out:
        logger.info("Auto-checkout at shift end: checked out %d employee(s)", len(checked_out))
    return {"action": "auto_checkout_shift_end", "employee_ids": checked_out}
