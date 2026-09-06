from datetime import datetime
from uuid import UUID

from . import CamelModel


class TicketOut(CamelModel):
    id: UUID
    task_id: UUID
    employee_id: UUID
    started_at: datetime
    ended_at: datetime
    tracked_ms: int
    productivity_score: float
    source: str
    created_at: datetime


class PaginatedTickets(CamelModel):
    items: list[TicketOut]
    total: int
    page: int
    page_size: int
