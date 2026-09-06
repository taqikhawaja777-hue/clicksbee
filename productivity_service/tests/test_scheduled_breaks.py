"""Exercises the shift_events service methods that app.jobs.scheduled_breaks
relies on (get_employees_eligible_for_scheduled_break, start_break,
end_break, get_latest_shift_event) against a fake in-memory Supabase client -
same pattern as test_jibble_sync.py, since the job wrapper functions
construct their own get_supabase_client() and aren't unit-testable directly
without a live/injectable client, matching this codebase's existing
convention of testing the service layer rather than the job entrypoint.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.services.productivity import ProductivityService

from .fakes import FakeSupabaseClient


def _seed_employee(store: dict, name: str = "Ada Lovelace") -> str:
    employee_id = str(uuid4())
    store.setdefault("employees", []).append(
        {"id": employee_id, "full_name": name, "email": f"{name}@example.com"}
    )
    return employee_id


def test_eligible_for_scheduled_break_only_includes_checked_in_not_on_break():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    now = datetime.now(timezone.utc)

    checked_in = _seed_employee(store, "Checked In")
    already_on_break = _seed_employee(store, "Already On Break")
    checked_out = _seed_employee(store, "Checked Out")
    _seed_employee(store, "Never Checked In")

    # Explicit, strictly-increasing occurred_at per event - real usage
    # always has seconds/minutes between sequential actions for one
    # employee; only a tight test loop with no real work between calls
    # risks landing two inserts on the same microsecond-resolution tick.
    t = now - timedelta(hours=1)
    service.log_check_in(checked_in, occurred_at=t)
    service.log_check_in(already_on_break, occurred_at=t)
    service.start_break(already_on_break, break_type="MANUAL", triggered_by="manual", occurred_at=t + timedelta(minutes=1))
    service.log_check_in(checked_out, occurred_at=t)
    service.log_check_out(checked_out, occurred_at=t + timedelta(minutes=1))

    eligible_ids = {e["id"] for e in service.get_employees_eligible_for_scheduled_break(now)}

    assert eligible_ids == {checked_in}


def test_start_scheduled_break_is_idempotent_on_rerun():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    service.log_check_in(employee_id)

    schedule_key = "2026-09-06:LUNCH_ZUHAR:start"
    first = service.start_break(
        employee_id, break_type="LUNCH_ZUHAR", triggered_by="scheduled",
        label="Lunch & Zuhar Break", schedule_key=schedule_key,
    )
    second = service.start_break(
        employee_id, break_type="LUNCH_ZUHAR", triggered_by="scheduled",
        label="Lunch & Zuhar Break", schedule_key=schedule_key,
    )

    break_start_rows = [
        r for r in store["shift_events"]
        if r["employee_id"] == employee_id and r["event_type"] == "break_start"
    ]
    assert len(break_start_rows) == 1
    assert first["id"] == second["id"]


def test_end_scheduled_break_only_ends_matching_scheduled_break_not_manual():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    now = datetime.now(timezone.utc)
    t = now - timedelta(hours=1)

    scheduled_employee = _seed_employee(store, "On Scheduled Break")
    manual_employee = _seed_employee(store, "On Manual Break")

    service.log_check_in(scheduled_employee, occurred_at=t)
    service.start_break(
        scheduled_employee, break_type="LUNCH_ZUHAR", triggered_by="scheduled",
        occurred_at=t + timedelta(minutes=1),
    )
    service.log_check_in(manual_employee, occurred_at=t)
    service.start_break(
        manual_employee, break_type="MANUAL", triggered_by="manual",
        occurred_at=t + timedelta(minutes=1),
    )

    # Simulate what app.jobs.scheduled_breaks.end_scheduled_break does.
    ended = []
    for employee in service.list_employees():
        latest = service.get_latest_shift_event(employee["id"], before=now)
        if (
            latest
            and latest["event_type"] == "break_start"
            and latest.get("triggered_by") == "scheduled"
            and latest.get("break_type") == "LUNCH_ZUHAR"
        ):
            service.end_break(employee["id"], break_type="LUNCH_ZUHAR", triggered_by="scheduled")
            ended.append(employee["id"])

    assert ended == [scheduled_employee]
    manual_latest = service.get_latest_shift_event(manual_employee)
    assert manual_latest["event_type"] == "break_start"  # untouched


def test_get_shift_summary_status_transitions():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()

    # Not checked in yet.
    summary = service.get_shift_summary(employee_id, today)
    assert summary["status"] == "NOT_CHECKED_IN"
    assert summary["is_checked_in"] is False

    # Checked in.
    service.log_check_in(employee_id)
    summary = service.get_shift_summary(employee_id, today)
    assert summary["is_checked_in"] is True
    assert summary["status"] == "ACTIVE"

    # On break.
    service.start_break(employee_id, break_type="MANUAL", triggered_by="manual")
    summary = service.get_shift_summary(employee_id, today)
    assert summary["is_on_break"] is True
    assert summary["status"] == "ON_BREAK"

    # Grace period right after break ends.
    service.end_break(employee_id, break_type="MANUAL", triggered_by="manual")
    summary = service.get_shift_summary(employee_id, today)
    assert summary["is_on_break"] is False
    assert summary["status"] == "ACTIVE"  # forced by grace period, not idle_time_logs

    # Checked out.
    service.log_check_out(employee_id)
    summary = service.get_shift_summary(employee_id, today)
    assert summary["is_checked_in"] is False
    assert summary["status"] == "CHECKED_OUT"


def test_get_shift_summary_shift_duration_excludes_break_time():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    now = datetime.now(timezone.utc)
    today = now.date()

    # Relative to "now" (not fixed calendar timestamps) so this test is
    # deterministic regardless of when it actually runs - _reconstruct_session
    # only looks back 24h from the real "now" at call time, so a hardcoded
    # future-looking clock time would fall outside that window and silently
    # find zero events depending on the time of day the suite executes.
    check_in_at = now - timedelta(hours=8)
    break_start_at = now - timedelta(hours=4)
    break_end_at = now - timedelta(hours=3, minutes=20)
    check_out_at = now

    store.setdefault("shift_events", []).extend(
        [
            {
                "id": str(uuid4()), "employee_id": employee_id, "event_type": "check_in",
                "occurred_at": check_in_at.isoformat(), "break_type": None,
                "triggered_by": "manual", "label": None, "schedule_key": None,
                "created_at": check_in_at.isoformat(),
            },
            {
                "id": str(uuid4()), "employee_id": employee_id, "event_type": "break_start",
                "occurred_at": break_start_at.isoformat(), "break_type": "LUNCH_ZUHAR",
                "triggered_by": "scheduled", "label": "Lunch & Zuhar Break", "schedule_key": None,
                "created_at": break_start_at.isoformat(),
            },
            {
                "id": str(uuid4()), "employee_id": employee_id, "event_type": "break_end",
                "occurred_at": break_end_at.isoformat(), "break_type": "LUNCH_ZUHAR",
                "triggered_by": "scheduled", "label": None, "schedule_key": None,
                "created_at": break_end_at.isoformat(),
            },
            {
                "id": str(uuid4()), "employee_id": employee_id, "event_type": "check_out",
                "occurred_at": check_out_at.isoformat(), "break_type": None,
                "triggered_by": "manual", "label": None, "schedule_key": None,
                "created_at": check_out_at.isoformat(),
            },
        ]
    )

    summary = service.get_shift_summary(employee_id, today)

    # 9:00 -> 17:00 = 8h, minus a 40-minute break = 7h20m = 26400s.
    assert summary["break_seconds"] == 2400
    assert summary["shift_duration_seconds"] == 26400
    assert summary["status"] == "CHECKED_OUT"
