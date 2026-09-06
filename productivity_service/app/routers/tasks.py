import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_productivity_service
from ..schemas.task import TaskCreate, TaskOut, TaskProductivityOut
from ..schemas.ticket import TicketOut
from ..services.jibble_client import get_jibble_client
from ..services.productivity import ProductivityService

logger = logging.getLogger("tasks_router")

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    payload: TaskCreate,
    service: ProductivityService = Depends(get_productivity_service),
) -> TaskOut:
    if service.get_employee(payload.employee_id) is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    jibble_activity_id = None
    try:
        activity = get_jibble_client().find_activity_by_name(payload.title)
        if activity:
            jibble_activity_id = str(activity.get("id"))
    except Exception:
        # Jibble not configured/unreachable shouldn't block task creation -
        # the sync job will still create/link the task later once a
        # matching Jibble activity reports time entries.
        logger.warning("Skipping Jibble activity lookup for task %r", payload.title, exc_info=True)

    task = service.create_task(
        payload.employee_id, payload.title, payload.estimated_minutes, jibble_activity_id
    )
    return TaskOut(**task)


@router.get("/{task_id}/productivity", response_model=TaskProductivityOut)
def get_task_productivity(
    task_id: UUID,
    service: ProductivityService = Depends(get_productivity_service),
) -> TaskProductivityOut:
    task = service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    tracked_ms, score = service.get_task_productivity(task)
    return TaskProductivityOut(task_id=task_id, tracked_ms=tracked_ms, score=score)


@router.post("/{task_id}/close", response_model=TicketOut)
def close_task(
    task_id: UUID,
    service: ProductivityService = Depends(get_productivity_service),
) -> TicketOut:
    task = service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] == "completed":
        raise HTTPException(status_code=422, detail="Task is already closed")

    ticket = service.close_task(task_id, task)
    return TicketOut(**ticket)
