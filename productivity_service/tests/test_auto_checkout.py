from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.jobs import auto_checkout
from app.services.productivity import ProductivityService

from .fakes import FakeSupabaseClient


def _seed_employee(store: dict, name: str) -> str:
    employee_id = str(uuid4())
    store.setdefault("employees", []).append(
        {
            "id": employee_id,
            "full_name": name,
            "email": f"{name.replace(' ', '.')}@example.com",
            "role": "EMPLOYEE",
        }
    )
    return employee_id


def test_auto_checkout_closes_open_shifts_and_skips_completed_shifts(monkeypatch):
    store: dict = {}
    client = FakeSupabaseClient(store)
    service = ProductivityService(client)
    now = datetime.now(timezone.utc)
    check_in_at = now - timedelta(hours=8)

    checked_in = _seed_employee(store, "Still Working")
    on_break = _seed_employee(store, "On Break")
    already_checked_out = _seed_employee(store, "Finished")

    service.log_check_in(checked_in, occurred_at=check_in_at)
    service.log_check_in(on_break, occurred_at=check_in_at)
    service.start_break(
        on_break,
        break_type="MANUAL",
        triggered_by="manual",
        occurred_at=check_in_at + timedelta(hours=2),
    )
    service.log_check_in(already_checked_out, occurred_at=check_in_at)
    service.log_check_out(already_checked_out, occurred_at=now - timedelta(minutes=1))

    monkeypatch.setattr(auto_checkout, "get_supabase_client", lambda: client)
    monkeypatch.setattr(auto_checkout, "notify_system_event", lambda **_kwargs: None)

    result = auto_checkout.auto_checkout_at_shift_end()

    assert set(result["employee_ids"]) == {checked_in, on_break}
    checkouts = [event for event in store["shift_events"] if event["event_type"] == "check_out"]
    assert len(checkouts) == 3

    second_run = auto_checkout.auto_checkout_at_shift_end()
    assert second_run["employee_ids"] == []
    assert len([event for event in store["shift_events"] if event["event_type"] == "check_out"]) == 3