from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_productivity_service
from ..schemas.activity import ActivityEventBatchOut, ActivityEventIn
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.post("/events", response_model=ActivityEventBatchOut, status_code=201)
def ingest_activity_events(
    events: list[ActivityEventIn],
    service: ProductivityService = Depends(get_productivity_service),
) -> ActivityEventBatchOut:
    if not events:
        return ActivityEventBatchOut(inserted=0)

    for task_id in {event.task_id for event in events}:
        if service.get_task(task_id) is None:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    for employee_id in {event.employee_id for event in events}:
        if service.get_employee(employee_id) is None:
            raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")

    inserted = service.insert_activity_events(events)
    return ActivityEventBatchOut(inserted=inserted)
