"""Exercises ProductivityService.close_task end to end against a fake,
in-memory Supabase client so the synced_time_entries -> scoring ->
ticket-insert -> task-status-update flow is verified without a live
database or a real Jibble account.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.services.productivity import ProductivityService

from .fakes import FakeSupabaseClient


def _make_task(task_id, employee_id, estimated_minutes=None):
    return {
        "id": str(task_id),
        "employee_id": str(employee_id),
        "title": "Write report",
        "status": "in_progress",
        "estimated_minutes": estimated_minutes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _time_entry(task_id, employee_id, start, minutes):
    end = start + timedelta(minutes=minutes)
    return {
        "id": str(uuid4()),
        "jibble_entry_id": f"jibble-{uuid4()}",
        "task_id": str(task_id),
        "employee_id": str(employee_id),
        "activity_name": "Write report",
        "entry_start": start.isoformat(),
        "entry_end": end.isoformat(),
        "duration_ms": minutes * 60_000,
    }


def test_close_task_with_estimate_scores_against_estimate_and_creates_ticket():
    task_id, employee_id = uuid4(), uuid4()
    task = _make_task(task_id, employee_id, estimated_minutes=60)
    now = datetime.now(timezone.utc)

    store = {
        "tasks": [task],
        "synced_time_entries": [
            _time_entry(task_id, employee_id, now - timedelta(minutes=45), 45),
        ],
        "tickets": [],
    }
    service = ProductivityService(FakeSupabaseClient(store))

    ticket = service.close_task(task_id, task)

    assert ticket["tracked_ms"] == 45 * 60_000
    assert ticket["productivity_score"] == 75.0  # 45 / 60 minutes
    assert ticket["source"] == "jibble"

    # the task flips to completed as part of the same close flow
    assert store["tasks"][0]["status"] == "completed"
    # exactly one ticket row was persisted
    assert len(store["tickets"]) == 1


def test_close_task_estimate_overrun_caps_score_at_100():
    task_id, employee_id = uuid4(), uuid4()
    task = _make_task(task_id, employee_id, estimated_minutes=30)
    now = datetime.now(timezone.utc)

    store = {
        "tasks": [task],
        "synced_time_entries": [
            _time_entry(task_id, employee_id, now - timedelta(minutes=90), 90),
        ],
        "tickets": [],
    }
    service = ProductivityService(FakeSupabaseClient(store))

    ticket = service.close_task(task_id, task)

    assert ticket["tracked_ms"] == 90 * 60_000
    assert ticket["productivity_score"] == 100.0


def test_close_task_without_estimate_falls_back_to_time_on_task_ratio():
    task_id, employee_id = uuid4(), uuid4()
    task = _make_task(task_id, employee_id, estimated_minutes=None)
    now = datetime.now(timezone.utc)

    other_task_id = uuid4()
    store = {
        "tasks": [task],
        "synced_time_entries": [
            # 20 minutes on this task...
            _time_entry(task_id, employee_id, now - timedelta(minutes=60), 20),
            # ...out of 80 minutes total clocked today across all tasks
            _time_entry(other_task_id, employee_id, now - timedelta(minutes=40), 60),
        ],
        "tickets": [],
    }
    service = ProductivityService(FakeSupabaseClient(store))

    ticket = service.close_task(task_id, task)

    assert ticket["tracked_ms"] == 20 * 60_000
    assert ticket["productivity_score"] == 25.0  # 20 / 80 minutes


def test_close_task_with_no_time_entries_scores_zero_not_division_error():
    task_id, employee_id = uuid4(), uuid4()
    task = _make_task(task_id, employee_id, estimated_minutes=None)
    store = {"tasks": [task], "synced_time_entries": [], "tickets": []}
    service = ProductivityService(FakeSupabaseClient(store))

    ticket = service.close_task(task_id, task)

    assert ticket["tracked_ms"] == 0
    assert ticket["productivity_score"] == 0.0
