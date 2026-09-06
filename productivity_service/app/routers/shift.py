from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import get_productivity_service
from ..schemas.shift import (
    BreakStatusOut,
    CheckInOut,
    ShiftEventOut,
    ShiftSummaryOut,
    TriggerScheduledBreakIn,
)
from ..services.productivity import KARACHI_TZ, ProductivityService

router = APIRouter(prefix="/api/shift", tags=["shift"])


def _karachi_today() -> date:
    return datetime.now(KARACHI_TZ).date()


@router.get("/summary/{employee_id}", response_model=ShiftSummaryOut)
def get_summary(
    employee_id: UUID,
    # Shift/break "days" - and, as of the KARACHI_TZ fix in
    # productivity.py, presence-summary days too - follow the org's fixed
    # timezone, matching the Zuhar/Asar-named break windows.
    on_date: date = Query(default_factory=_karachi_today, alias="date"),
    service: ProductivityService = Depends(get_productivity_service),
) -> ShiftSummaryOut:
    return ShiftSummaryOut(**service.get_shift_summary(employee_id, on_date))


@router.get("/break-status/{employee_id}", response_model=BreakStatusOut)
def get_break_status(
    employee_id: UUID,
    service: ProductivityService = Depends(get_productivity_service),
) -> BreakStatusOut:
    # Polled every 20s by both idleTimeTracker.ts and presenceDetector.ts,
    # which already fail open (treat any non-200 as "not on break") - avoid
    # a noisy 500 on every single poll if shift_events doesn't exist yet
    # (migration 005 not applied) by degrading the same way here.
    try:
        latest = service.get_latest_shift_event(employee_id)
    except Exception:
        latest = None
    on_break = bool(latest and latest["event_type"] == "break_start")
    return BreakStatusOut(
        employee_id=employee_id,
        on_break=on_break,
        break_type=latest.get("break_type") if on_break else None,
        triggered_by=latest.get("triggered_by") if on_break else None,
        break_started_at=latest.get("occurred_at") if on_break else None,
    )


@router.post("/check-in", response_model=ShiftEventOut, status_code=201)
def check_in(
    payload: CheckInOut,
    service: ProductivityService = Depends(get_productivity_service),
) -> ShiftEventOut:
    return ShiftEventOut(**service.log_check_in(payload.employee_id))


@router.post("/check-out", response_model=ShiftEventOut, status_code=201)
def check_out(
    payload: CheckInOut,
    service: ProductivityService = Depends(get_productivity_service),
) -> ShiftEventOut:
    return ShiftEventOut(**service.log_check_out(payload.employee_id))


@router.post("/break/start", response_model=ShiftEventOut, status_code=201)
def start_manual_break(
    payload: CheckInOut,
    service: ProductivityService = Depends(get_productivity_service),
) -> ShiftEventOut:
    """The manual "Start Break" button. The server, not the client, decides
    triggered_by/break_type here - always 'manual'/'MANUAL' - so a modified
    client can't misattribute a manual break as scheduled."""
    latest = service.get_latest_shift_event(payload.employee_id)
    if latest and latest["event_type"] == "break_start":
        raise HTTPException(status_code=409, detail="Employee is already on a break")
    return ShiftEventOut(
        **service.start_break(
            employee_id=payload.employee_id,
            break_type="MANUAL",
            triggered_by="manual",
            label="Manual Break",
        )
    )


@router.post("/break/end", response_model=ShiftEventOut, status_code=201)
def end_manual_break(
    payload: CheckInOut,
    service: ProductivityService = Depends(get_productivity_service),
) -> ShiftEventOut:
    """The manual "End Break" button. Ends whatever break is currently
    open (scheduled or manual) - an employee ending a scheduled break
    early is recorded as a manual end of that break, preserving the
    original break_type while triggered_by reflects who ended it."""
    latest = service.get_latest_shift_event(payload.employee_id)
    if not latest or latest["event_type"] != "break_start":
        raise HTTPException(status_code=400, detail="Employee is not currently on a break")
    return ShiftEventOut(
        **service.end_break(
            employee_id=payload.employee_id,
            break_type=latest["break_type"],
            triggered_by="manual",
        )
    )


@router.post("/dev/trigger-scheduled-break")
def trigger_scheduled_break(payload: TriggerScheduledBreakIn) -> dict:
    """Dev/test hook - calls the exact same functions the cron scheduler
    invokes (see app.jobs.scheduled_breaks), so this exercises real
    production logic without waiting for the actual clock time."""
    from ..jobs.scheduled_breaks import end_scheduled_break, start_scheduled_break

    if payload.action == "start":
        return start_scheduled_break(payload.break_key)
    return end_scheduled_break(payload.break_key)
