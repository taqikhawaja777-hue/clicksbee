from uuid import UUID

from . import CamelModel


class EmployeeCreate(CamelModel):
    full_name: str
    email: str
    jibble_member_id: str | None = None


class EmployeeOut(CamelModel):
    id: UUID
    full_name: str
    email: str
    jibble_member_id: str | None = None
    camera_monitoring_enabled: bool = False


class ActiveEmployeeOut(CamelModel):
    employee_id: UUID
    employee_name: str
    task_id: UUID
    task_title: str
    tracked_minutes: float
    score: float
