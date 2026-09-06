from datetime import datetime
from uuid import UUID

from . import CamelModel


class TaskCreate(CamelModel):
    employee_id: UUID
    title: str
    estimated_minutes: int | None = None


class TaskOut(CamelModel):
    id: UUID
    employee_id: UUID
    title: str
    status: str
    estimated_minutes: int | None = None
    jibble_activity_id: str | None = None
    created_at: datetime


class TaskProductivityOut(CamelModel):
    task_id: UUID
    tracked_ms: int
    score: float
