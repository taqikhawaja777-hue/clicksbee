"""Exercises ProductivityService.upsert_synced_time_entry - the core of the
sync job - against a fake in-memory Supabase client, focused on the
idempotency guarantee: running the same entry (or the same sync window)
twice must not create duplicate rows.
"""

from uuid import uuid4

import pytest

from app.services.productivity import ProductivityService

from .fakes import FakeSupabaseClient


def _seed_employee(store: dict, jibble_member_id: str = "member-1") -> str:
    employee_id = str(uuid4())
    store.setdefault("employees", []).append(
        {
            "id": employee_id,
            "full_name": "Ada Lovelace",
            "email": "ada@example.com",
            "jibble_member_id": jibble_member_id,
        }
    )
    return employee_id


def _sample_entry(entry_id="entry-1", member_id="member-1", activity_id="activity-1"):
    return {
        "id": entry_id,
        "memberId": member_id,
        "activityId": activity_id,
        "activityName": "Design Review",
        "startTime": "2026-08-30T09:00:00Z",
        "endTime": "2026-08-30T09:30:00Z",
        "duration": 1800,  # seconds
        "updatedAt": "2026-08-30T09:30:05Z",
    }


def test_upsert_synced_time_entry_is_idempotent_on_rerun():
    store: dict = {}
    _seed_employee(store)
    service = ProductivityService(FakeSupabaseClient(store))

    entry = _sample_entry()

    first = service.upsert_synced_time_entry(entry)
    second = service.upsert_synced_time_entry(entry)  # simulate the sync job re-running

    assert first["task_created"] is True
    assert second["task_created"] is False  # the task already existed on the re-run

    # exactly one synced_time_entries row and one tasks row - not duplicated
    assert len(store["synced_time_entries"]) == 1
    assert len(store["tasks"]) == 1
    assert store["synced_time_entries"][0]["jibble_entry_id"] == "entry-1"


def test_upsert_synced_time_entry_reuses_task_across_entries_for_same_activity():
    store: dict = {}
    _seed_employee(store)
    service = ProductivityService(FakeSupabaseClient(store))

    service.upsert_synced_time_entry(_sample_entry(entry_id="entry-1"))
    service.upsert_synced_time_entry(_sample_entry(entry_id="entry-2"))

    assert len(store["tasks"]) == 1
    assert len(store["synced_time_entries"]) == 2


def test_upsert_synced_time_entry_updates_in_place_when_entry_changes():
    store: dict = {}
    _seed_employee(store)
    service = ProductivityService(FakeSupabaseClient(store))

    service.upsert_synced_time_entry(_sample_entry(entry_id="entry-1"))
    changed = _sample_entry(entry_id="entry-1")
    changed["duration"] = 3600  # entry edited in Jibble, re-synced

    service.upsert_synced_time_entry(changed)

    assert len(store["synced_time_entries"]) == 1
    assert store["synced_time_entries"][0]["duration_ms"] == 3_600_000


def test_upsert_synced_time_entry_raises_for_unmapped_member():
    store: dict = {}  # no employees seeded
    service = ProductivityService(FakeSupabaseClient(store))

    with pytest.raises(ValueError):
        service.upsert_synced_time_entry(_sample_entry())


def test_upsert_synced_time_entry_raises_for_missing_required_fields():
    store: dict = {}
    _seed_employee(store)
    service = ProductivityService(FakeSupabaseClient(store))

    bad_entry = {"memberId": "member-1"}  # no id, no startTime

    with pytest.raises(ValueError):
        service.upsert_synced_time_entry(bad_entry)
