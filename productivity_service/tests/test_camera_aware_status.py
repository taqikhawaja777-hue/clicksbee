"""Exercises get_shift_summary()'s camera-aware status ("Today, per
employee" widget): a fresh presence_logs sample's combined_status is used
outright (ACTIVE if face OR input, IDLE if neither but not yet AWAY,
AWAY otherwise) - the same single OR-based definition already computed
client-side, with no second competing "camera beats input" rule layered
on top of it. No camera data (or stale camera data) falls back to the
pre-existing input-only behavior unchanged.
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


def _seed_idle_time_log(store: dict, employee_id: str, day: date, updated_at: datetime) -> None:
    store.setdefault("idle_time_logs", []).append(
        {
            "id": str(uuid4()),
            "employee_id": employee_id,
            "date": day.isoformat(),
            "active_seconds": 100,
            "idle_seconds": 0,
            "app_focus_seconds": {"Other": 100},
            "total_logged_seconds": 100,
            "last_active_app": "Other",
            "last_is_idle": False,
            "updated_at": updated_at.isoformat(),
        }
    )


def _seed_presence_log(
    store: dict,
    employee_id: str,
    occurred_at: datetime,
    face_detected: bool,
    mouse_keyboard_active: bool,
    combined_status: str | None = None,
) -> None:
    # Mirrors presenceDetector.ts's runCheck(): active if face OR input,
    # else idle - "away" only happens once idleSeconds crosses its own
    # threshold, which a single sample can't express, so tests that need
    # "away" pass combined_status explicitly.
    combined = combined_status or ("active" if (face_detected or mouse_keyboard_active) else "idle")
    store.setdefault("presence_logs", []).append(
        {
            "id": str(uuid4()),
            "employee_id": employee_id,
            "occurred_at": occurred_at.isoformat(),
            "face_detected": face_detected,
            "mouse_keyboard_active": mouse_keyboard_active,
            "combined_status": combined,
        }
    )


def test_face_detected_is_active_even_without_recent_input():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    now = datetime.now(timezone.utc)
    today = now.date()

    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, updated_at=now)
    _seed_presence_log(store, employee_id, now - timedelta(seconds=10), face_detected=True, mouse_keyboard_active=False)

    summary = service.get_shift_summary(employee_id, today)
    assert summary["status"] == "ACTIVE"


def test_no_face_but_input_is_still_active():
    # combined_status is OR-based (face OR input -> active) - camera
    # presence cannot override a working input signal, closing the
    # collision where face detection failing silently downgraded a
    # genuinely-active employee to IDLE.
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    now = datetime.now(timezone.utc)
    today = now.date()

    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, updated_at=now)
    _seed_presence_log(store, employee_id, now - timedelta(seconds=10), face_detected=False, mouse_keyboard_active=True)

    summary = service.get_shift_summary(employee_id, today)
    assert summary["status"] == "ACTIVE"


def test_no_face_and_no_input_is_away():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    now = datetime.now(timezone.utc)
    today = now.date()

    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, updated_at=now)
    # No face, no input, and idleSeconds has crossed the client's own
    # away threshold - the client itself decided "away" for this sample.
    _seed_presence_log(
        store,
        employee_id,
        now - timedelta(seconds=10),
        face_detected=False,
        mouse_keyboard_active=False,
        combined_status="away",
    )

    summary = service.get_shift_summary(employee_id, today)
    assert summary["status"] == "AWAY"


def test_stale_presence_sample_falls_back_to_input_only_status():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    now = datetime.now(timezone.utc)
    today = now.date()

    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, updated_at=now)
    # Last camera check was 5 minutes ago - too stale to trust (camera
    # monitoring may have been turned off, or the app closed) - falls back
    # to the pre-existing input-only status, which is ACTIVE here since
    # idle_time_logs was just updated and last_is_idle is False.
    _seed_presence_log(store, employee_id, now - timedelta(minutes=5), face_detected=False, mouse_keyboard_active=False)

    summary = service.get_shift_summary(employee_id, today)
    assert summary["status"] == "ACTIVE"


def test_no_camera_data_at_all_falls_back_to_input_only_status():
    store: dict = {}
    service = ProductivityService(FakeSupabaseClient(store))
    employee_id = _seed_employee(store)
    now = datetime.now(timezone.utc)
    today = now.date()

    service.log_check_in(employee_id)
    _seed_idle_time_log(store, employee_id, today, updated_at=now)
    # No presence_logs rows at all - employee never enabled/consented to
    # camera monitoring. Must not break; falls back unchanged.

    summary = service.get_shift_summary(employee_id, today)
    assert summary["status"] == "ACTIVE"
