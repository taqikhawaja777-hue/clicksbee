"""Exercises the unified Overall Productivity formula (Attendance Ratio +
App Focus Score + Compliance Score, weighted) - both the pure sub-score
functions in isolation and the full get_daily_report_row()/
get_shift_summary() integration against a fake in-memory Supabase client,
same pattern as test_reports.py."""
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from app.services.productivity import DEFAULT_PRODUCTIVITY_CONFIG, ProductivityService

from .fakes import FakeSupabaseClient


def _seed_employee(store: dict, name: str = "Ada Lovelace") -> str:
    employee_id = str(uuid4())
    store.setdefault("employees", []).append(
        {"id": employee_id, "full_name": name, "email": f"{name}@example.com"}
    )
    return employee_id


def _seed_idle_time_log(
    store: dict, employee_id: str, day: date, active: int, idle: int, jabber: int = 0, wildix: int = 0
) -> None:
    app_focus = {"Other": max(0, active - jabber - wildix)}
    if jabber:
        app_focus["Cisco Jabber"] = jabber
    if wildix:
        app_focus["Wildix"] = wildix
    store.setdefault("idle_time_logs", []).append(
        {
            "id": str(uuid4()),
            "employee_id": employee_id,
            "date": day.isoformat(),
            "active_seconds": active,
            "idle_seconds": idle,
            "app_focus_seconds": app_focus,
            "total_logged_seconds": active + idle,
            "last_active_app": "Other",
            "last_is_idle": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def _seed_presence_row(store: dict, employee_id: str, when: datetime, status: str) -> None:
    store.setdefault("presence_logs", []).append(
        {
            "id": str(uuid4()),
            "employee_id": employee_id,
            "occurred_at": when.isoformat(),
            "face_detected": status == "active",
            "mouse_keyboard_active": status == "active",
            "combined_status": status,
        }
    )


# ---- pure sub-score functions ------------------------------------------


def test_attendance_ratio_basic_and_capped():
    assert ProductivityService._compute_attendance_ratio(3600, 7200) == 50.0
    # Combined active time can't sensibly exceed shift time in a correct
    # system, but if it does (presence poll rounding, etc.), cap at 100
    # rather than reporting >100% attendance.
    assert ProductivityService._compute_attendance_ratio(9000, 7200) == 100.0
    assert ProductivityService._compute_attendance_ratio(100, 0) == 0.0


def test_app_focus_score_basic_and_zero_denominator():
    assert ProductivityService._compute_app_focus_score(1000, 500, 3000) == 50.0
    assert ProductivityService._compute_app_focus_score(0, 0, 0) == 0.0


def test_compliance_score_idle_penalty():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    # Threshold 1800s (30min); 3600s idle = 1800s excess = 30 minutes over,
    # at 1 point/minute = 30 points off.
    score, breakdown = ProductivityService._compute_compliance_score(3600, [], [], config)
    assert score == 70.0
    assert breakdown["idlePenaltyPoints"] == 30.0
    assert breakdown["lateReturnPenaltyPoints"] == 0.0
    assert breakdown["washroomPenaltyPoints"] == 0.0


def test_compliance_score_idle_penalty_caps_at_configured_max():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    # Wildly excessive idle time shouldn't drive the penalty past
    # idle_penalty_max_points (40).
    score, breakdown = ProductivityService._compute_compliance_score(100_000, [], [], config)
    assert breakdown["idlePenaltyPoints"] == 40.0
    assert score == 60.0


def test_compliance_score_late_return_from_scheduled_break_penalized():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    break_end_at = datetime(2026, 9, 11, 14, 10, tzinfo=timezone.utc)
    events = [
        {"event_type": "break_end", "triggered_by": "scheduled", "occurred_at": break_end_at.isoformat()},
    ]
    # No presence row shows "active" within the 2-minute grace window -
    # counts as a late return.
    presence_rows = [
        {"occurred_at": (break_end_at + timedelta(seconds=30)).isoformat(), "combined_status": "idle"},
        {"occurred_at": (break_end_at + timedelta(seconds=90)).isoformat(), "combined_status": "away"},
    ]
    score, breakdown = ProductivityService._compute_compliance_score(0, events, presence_rows, config)
    assert breakdown["lateReturnCount"] == 1
    assert breakdown["lateReturnPenaltyPoints"] == config["late_return_penalty_points"]
    assert score == 100.0 - config["late_return_penalty_points"]


def test_compliance_score_on_time_return_not_penalized():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    break_end_at = datetime(2026, 9, 11, 14, 10, tzinfo=timezone.utc)
    events = [
        {"event_type": "break_end", "triggered_by": "scheduled", "occurred_at": break_end_at.isoformat()},
    ]
    # A confirmed-active presence row inside the grace window - back on
    # time, no penalty.
    presence_rows = [
        {"occurred_at": (break_end_at + timedelta(seconds=45)).isoformat(), "combined_status": "active"},
    ]
    score, breakdown = ProductivityService._compute_compliance_score(0, events, presence_rows, config)
    assert breakdown["lateReturnCount"] == 0
    assert score == 100.0


def test_compliance_score_no_presence_data_cannot_verify_no_penalty():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    break_end_at = datetime(2026, 9, 11, 14, 10, tzinfo=timezone.utc)
    events = [
        {"event_type": "break_end", "triggered_by": "scheduled", "occurred_at": break_end_at.isoformat()},
    ]
    # No presence_logs rows at all in the window (e.g. employee never
    # enabled camera monitoring) - can't verify, so no penalty rather than
    # guessing.
    score, breakdown = ProductivityService._compute_compliance_score(0, events, [], config)
    assert breakdown["lateReturnCount"] == 0
    assert score == 100.0


def test_compliance_score_manual_break_late_return_not_penalized():
    """Only SCHEDULED break returns are subject to the grace-period
    penalty per the spec - a manual break ending "late" (the employee
    decides when to end their own manual break) isn't a compliance
    violation."""
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    break_end_at = datetime(2026, 9, 11, 14, 10, tzinfo=timezone.utc)
    events = [
        {"event_type": "break_end", "triggered_by": "manual", "occurred_at": break_end_at.isoformat()},
    ]
    presence_rows = [
        {"occurred_at": (break_end_at + timedelta(seconds=30)).isoformat(), "combined_status": "idle"},
    ]
    score, breakdown = ProductivityService._compute_compliance_score(0, events, presence_rows, config)
    assert breakdown["lateReturnCount"] == 0
    assert score == 100.0


def test_compliance_score_washroom_over_limit_and_over_duration():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    base = datetime(2026, 9, 11, 9, 0, tzinfo=timezone.utc)

    def washroom_pair(start_offset_min: int, duration_min: float) -> list[dict]:
        start = base + timedelta(minutes=start_offset_min)
        end = start + timedelta(minutes=duration_min)
        return [
            {"event_type": "break_start", "break_type": "WASHROOM", "occurred_at": start.isoformat()},
            {"event_type": "break_end", "break_type": "WASHROOM", "occurred_at": end.isoformat()},
        ]

    events = []
    # 4 washroom breaks in one day (limit is 3) - the 4th is over the
    # daily count limit. One of them (the 2nd) also runs 6 minutes,
    # over the 4-minute per-break limit.
    events += washroom_pair(0, 2)
    events += washroom_pair(30, 6)
    events += washroom_pair(60, 2)
    events += washroom_pair(90, 2)

    score, breakdown = ProductivityService._compute_compliance_score(0, events, [], config)
    assert breakdown["washroomBreakCount"] == 4
    assert breakdown["washroomOverLimitCount"] == 1
    assert breakdown["washroomOverDurationCount"] == 1
    # 2 violations (1 over-limit + 1 over-duration) * 5 points each = 10.
    assert breakdown["washroomPenaltyPoints"] == 2 * config["washroom_penalty_points"]
    assert score == 100.0 - 2 * config["washroom_penalty_points"]


# ---- weighted combiner ---------------------------------------------------


def test_weighted_combine_default_weights():
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    components = {"attendance": 80.0, "app_focus": 50.0, "compliance": 90.0}
    # 80*0.4 + 50*0.3 + 90*0.3 = 32 + 15 + 27 = 74
    assert ProductivityService._weighted_combine(components, config) == 74.0


def test_weighted_combine_missing_component_contributes_zero_not_renormalized():
    """Call Efficiency isn't computed yet (no call-log integration) - its
    reserved weight (0 by default) means it contributes nothing without
    inflating the other three, proving the "add a 4th component later
    without rewriting this" design actually holds."""
    config = dict(DEFAULT_PRODUCTIVITY_CONFIG)
    components = {"attendance": 100.0, "app_focus": 100.0, "compliance": 100.0}
    assert ProductivityService._weighted_combine(components, config) == 100.0

    # Even if call_efficiency_weight were configured non-zero ahead of the
    # component existing, an absent "call_efficiency" key in `components`
    # simply isn't summed - config.get(f"{key}_weight") only ever looks up
    # weights for keys that ARE present in `components`.
    config_with_reserved_weight = {**config, "call_efficiency_weight": 20}
    assert ProductivityService._weighted_combine(components, config_with_reserved_weight) == 100.0


# ---- full integration: one employee, one day -----------------------------


def test_overall_productivity_full_breakdown_for_one_employee_day():
    """End-to-end: seeds a realistic day (8h shift with a 40-minute lunch
    break, on-time return, some Jabber/Wildix usage, some idle time) and
    checks every sub-score and the final weighted result by hand."""
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store, "Test Employee")
    today = datetime.now(timezone.utc).date()
    check_in_at = datetime.now(timezone.utc) - timedelta(hours=9)

    # Shift: 09:00 - 17:30 (8.5h wall-clock), with a scheduled 40-minute
    # lunch break employee returns from ON TIME.
    service.log_check_in(employee_id, occurred_at=check_in_at)
    break_start = check_in_at + timedelta(hours=4)
    break_end = break_start + timedelta(minutes=40)
    service.start_break(employee_id, break_type="LUNCH_ZUHAR", triggered_by="scheduled", occurred_at=break_start)
    service.end_break(employee_id, break_type="LUNCH_ZUHAR", triggered_by="scheduled", occurred_at=break_end)
    _seed_presence_row(store, employee_id, break_end + timedelta(seconds=20), "active")
    service.log_check_out(employee_id, occurred_at=check_in_at + timedelta(hours=8, minutes=30))

    # idle_time_logs: 5h active, 1h idle for the day; of the active time,
    # 1h Jabber + 30min Wildix.
    _seed_idle_time_log(
        store, employee_id, today, active=5 * 3600, idle=3600, jabber=3600, wildix=1800
    )

    # combined_active_seconds (camera+input) for the day: 4.5h.
    poll_start = check_in_at
    _seed_presence_row(store, employee_id, poll_start, "active")
    for i in range(1, 30):
        status = "active" if i % 6 != 0 else "idle"
        _seed_presence_row(store, employee_id, poll_start + timedelta(minutes=i * 15), status)

    row = service.get_daily_report_row(employee_id, today)

    # shift_duration_seconds = 8.5h - 40min break = 7h50m = 28200s
    assert row["shift_duration_seconds"] == 7 * 3600 + 50 * 60
    assert row["jabber_seconds"] == 3600
    assert row["wildix_seconds"] == 1800
    assert row["idle_seconds"] == 3600

    expected_attendance = round(
        min(100.0, (row["combined_active_seconds"] / row["shift_duration_seconds"]) * 100), 2
    )
    expected_app_focus = round(min(100.0, (5400 / row["combined_active_seconds"]) * 100), 2)
    # idle 3600s vs 1800s threshold = 1800s excess = 30min * 1pt/min = 30pt off
    expected_compliance = 70.0

    assert row["attendance_ratio"] == expected_attendance
    assert row["app_focus_score"] == expected_app_focus
    assert row["compliance_score"] == expected_compliance
    assert row["compliance_breakdown"]["lateReturnCount"] == 0  # returned on time

    expected_overall = round(
        expected_attendance * 0.4 + expected_app_focus * 0.3 + expected_compliance * 0.3, 2
    )
    assert row["productivity_percentage"] == expected_overall
    assert row["weights_used"] == {
        "attendanceWeight": 40.0,
        "appFocusWeight": 30.0,
        "complianceWeight": 30.0,
        "callEfficiencyWeight": 0.0,
    }


def test_get_shift_summary_agrees_with_daily_report_row_once_checked_out():
    """The exact mismatch this whole feature was built to eliminate: once
    a day is "closed" (checked out), a live get_shift_summary() call and a
    get_daily_report_row() call for the SAME employee/day must report the
    identical Overall Productivity percentage - both now go through
    _compute_overall_productivity() with the same day-scoped inputs."""
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()
    check_in_at = datetime.now(timezone.utc) - timedelta(hours=3)
    service.log_check_in(employee_id, occurred_at=check_in_at)
    service.log_check_out(employee_id, occurred_at=check_in_at + timedelta(hours=3))
    _seed_idle_time_log(store, employee_id, today, active=2 * 3600, idle=1800, jabber=600)

    live = service.get_shift_summary(employee_id, today)
    report = service.get_daily_report_row(employee_id, today)

    assert live["productivity_percentage"] == report["productivity_percentage"]
    assert live["attendance_ratio"] == report["attendance_ratio"]
    assert live["compliance_score"] == report["compliance_score"]


def test_get_shift_summary_live_attendance_ratio_not_zero_while_still_checked_in():
    """Before the `now`-aware fix, get_shift_summary() fed
    _compute_daily_report_row()'s report-semantics shift duration (which
    is deliberately 0 for a day with no check_out yet) straight into the
    live Attendance Ratio - meaning anyone actively checked in and working
    would show 0% Attendance Ratio (and a depressed Overall Productivity)
    all day, every day, until they checked out. This must not regress."""
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    today = datetime.now(timezone.utc).date()
    check_in_at = datetime.now(timezone.utc) - timedelta(hours=3)
    service.log_check_in(employee_id, occurred_at=check_in_at)
    _seed_idle_time_log(store, employee_id, today, active=2 * 3600, idle=1800)
    # Some real combined active time so the numerator isn't trivially 0 too.
    for i in range(12):
        _seed_presence_row(store, employee_id, check_in_at + timedelta(minutes=i * 15), "active")

    live = service.get_shift_summary(employee_id, today)

    assert live["shift_duration_seconds"] > 0  # unaffected: session-based, not report-based
    assert live["attendance_ratio"] > 0
    assert live["productivity_percentage"] > 0
