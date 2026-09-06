from datetime import datetime
from uuid import UUID

from pydantic import field_validator

from . import CamelModel


class ActivityEventIn(CamelModel):
    task_id: UUID
    employee_id: UUID
    app_name: str | None = None
    is_idle: bool = False
    event_start: datetime
    event_end: datetime

    @field_validator("event_end")
    @classmethod
    def event_end_after_start(cls, event_end: datetime, info) -> datetime:
        event_start = info.data.get("event_start")
        if event_start is not None and event_end <= event_start:
            raise ValueError("eventEnd must be after eventStart")
        return event_end

    @property
    def duration_ms(self) -> int:
        return int((self.event_end - self.event_start).total_seconds() * 1000)


class ActivityEventBatchOut(CamelModel):
    inserted: int
