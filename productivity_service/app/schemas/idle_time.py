from datetime import date as date_
from datetime import datetime
from uuid import UUID

from . import CamelModel


class IdleTimeLogIn(CamelModel):
    """One batched snapshot from the desktop client: cumulative totals for
    the employee's whole day so far, not a delta since the last POST."""

    employee_id: UUID
    date: date_
    active_seconds: int
    idle_seconds: int
    app_focus_seconds: dict[str, int] = {}
    last_active_app: str | None = None
    last_is_idle: bool = False


class IdleTimeLogOut(CamelModel):
    id: UUID
    employee_id: UUID
    date: date_
    active_seconds: int
    idle_seconds: int
    app_focus_seconds: dict[str, int]
    total_logged_seconds: int
    last_active_app: str | None = None
    last_is_idle: bool
    created_at: datetime
    updated_at: datetime


class EmployeeIdleStatusOut(CamelModel):
    employee_id: UUID
    employee_name: str
    date: date_
    active_seconds: int
    idle_seconds: int
    jabber_seconds: int
    wildix_seconds: int
    productivity_percentage: float
    # NOT_CHECKED_IN | CHECKED_OUT | ON_BREAK | ACTIVE_JABBER | ACTIVE_WILDIX
    # | ACTIVE | IDLE | AWAY - sourced from ProductivityService.get_shift_summary()
    status: str
    updated_at: datetime
    is_on_break: bool = False
    break_seconds: int = 0
    shift_duration_seconds: int = 0
    is_checked_in: bool = False


class IdleTimeSummaryOut(CamelModel):
    employees: list[EmployeeIdleStatusOut]
    avg_productivity_percentage: float
