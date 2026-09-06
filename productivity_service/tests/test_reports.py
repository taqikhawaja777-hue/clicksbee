"""Exercises get_daily_report_row() (day-scoped, multi-session-merging
report calculation) and the check-in baseline that lets get_shift_summary()
show live numbers "since this check-in" - against a fake in-memory
Supabase client, same pattern as test_scheduled_breaks.py.
"""
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from app.services.productivity import ProductivityService

from .fakes import FakeSupabaseClient


def _seed_employee(store: dict, name: str = "Ada Lovelace") -> str:
    employee_id = str(uuid4())
    store.setdefault("employees", []).append(
        {"id": employee_id, "full_name": name, "email": f"{name}@example.com"}
    )
    return employee_id


def _seed_idle_time_log(store: dict, employee_id: str, day: date, active: int, idle: int) -> None:
    store.setdefault("idle_time_logs", []).append(
        {
            "id": str(uuid4()),
            "employee_id": employee_id,
            "date": day.isoformat(),
            "active_seconds": active,
            "idle_seconds": idle,
            "app_focus_seconds": {"Other": active},
            "total_logged_seconds": active + idle,
            "last_active_app": "Other",
            "last_is_idle": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def test_daily_report_row_merges_multiple_sessions_same_day():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()
    t = datetime.now(timezone.utc) - timedelta(hours=8)

    # Session 1: 09:00 - 12:00, with a 20-minute break.
    service.log_check_in(employee_id, occurred_at=t)
    service.start_break(employee_id, break_type="MANUAL", triggered_by="manual", occurred_at=t + timedelta(hours=1))
    service.end_break(employee_id, break_type="MANUAL", triggered_by="manual", occurred_at=t + timedelta(hours=1, minutes=20))
    service.log_check_out(employee_id, occurred_at=t + timedelta(hours=3))

    # Session 2, same day: 13:00 - 17:00 (popped out and back in).
    service.log_check_in(employee_id, occurred_at=t + timedelta(hours=4))
    service.log_check_out(employee_id, occurred_at=t + timedelta(hours=8))

    row = service.get_daily_report_row(employee_id, today)

    assert row["attendance_status"] == "PRESENT"
    # Merged into ONE row, not two.
    assert row["check_in_at"] is not None and row["check_out_at"] is not None
    assert row["break_seconds"] == 1200  # 20 minutes, from session 1 only
    # (3h + 4h) of wall-clock session time minus the 20-minute break.
    assert row["shift_duration_seconds"] == 7 * 3600 - 1200
    assert row["still_checked_in"] is False


def test_daily_report_row_still_checked_in_has_no_checkout_time():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()

    service.log_check_in(employee_id)

    row = service.get_daily_report_row(employee_id, today)
    assert row["attendance_status"] == "PRESENT"
    assert row["check_in_at"] is not None
    assert row["check_out_at"] is None
    assert row["still_checked_in"] is True
    assert row["shift_duration_seconds"] == 0  # no checkout yet - nothing to report


def test_daily_report_row_absent_day():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()

    row = service.get_daily_report_row(employee_id, today)
    assert row["attendance_status"] == "ABSENT"
    assert row["check_in_at"] is None
    assert row["shift_duration_seconds"] == 0


def test_daily_report_row_reads_idle_time_logs_whole_day_total():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()

    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, active=5000, idle=200)

    row = service.get_daily_report_row(employee_id, today)
    # The report shows the FULL day's cumulative total, unlike the live
    # get_shift_summary() view, which would baseline-subtract this.
    assert row["active_seconds"] == 5000
    assert row["idle_seconds"] == 200


def test_check_in_baseline_resets_live_active_seconds_but_not_report_total():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()

    # First session: employee works, active_seconds accumulates to 3000.
    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, active=3000, idle=0)
    service.log_check_out(employee_id)

    # Second check-in the same day - snapshots baseline_active_seconds=3000.
    service.log_check_in(employee_id)
    # idle_time_logs keeps accumulating from where it was (whole-day
    # cumulative, untouched by check-in/out) - now at 3200 after more work.
    store["idle_time_logs"][0]["active_seconds"] = 3200

    live = service.get_shift_summary(employee_id, today)
    assert live["active_seconds"] == 200  # 3200 - baseline of 3000: reset per new session

    report = service.get_daily_report_row(employee_id, today)
    assert report["active_seconds"] == 3200  # full day total, sessions merged
