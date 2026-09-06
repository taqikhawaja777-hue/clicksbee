from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ..deps import get_productivity_service
from ..schemas.ticket import PaginatedTickets, TicketOut
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("", response_model=PaginatedTickets)
def list_tickets(
    employee_id: UUID | None = Query(default=None),
    task_id: UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    service: ProductivityService = Depends(get_productivity_service),
) -> PaginatedTickets:
    items, total = service.list_tickets(employee_id, task_id, page, page_size)
    return PaginatedTickets(
        items=[TicketOut(**row) for row in items],
        total=total,
        page=page,
        page_size=page_size,
    )
