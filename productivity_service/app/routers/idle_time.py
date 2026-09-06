from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ..deps import get_productivity_service
from ..schemas.idle_time import EmployeeIdleStatusOut, IdleTimeLogIn, IdleTimeLogOut, IdleTimeSummaryOut
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/idle-time", tags=["idle-time"])


@router.post("/log", response_model=IdleTimeLogOut, status_code=201)
def log_idle_time(
    payload: IdleTimeLogIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> IdleTimeLogOut:
    row = service.upsert_idle_time_log(payload)
    return IdleTimeLogOut(**row)


@router.get("/summary", response_model=IdleTimeSummaryOut)
def get_idle_time_summary(
    service: ProductivityService = Depends(get_productivity_service),
) -> IdleTimeSummaryOut:
    """Aggregated today-view for the Manager Supervisor Portal overview.
    Must be declared before `/{employee_id}` so "summary" isn't swallowed by
    that path param."""
    rows = service.get_idle_time_summary(date.today())
    employees = [EmployeeIdleStatusOut(**row) for row in rows]
    avg = (
        round(sum(e.productivity_percentage for e in employees) / len(employees), 2)
        if employees
        else 0.0
    )
    return IdleTimeSummaryOut(employees=employees, avg_productivity_percentage=avg)


@router.get("/{employee_id}", response_model=list[IdleTimeLogOut])
def get_employee_idle_time(
    employee_id: UUID,
    start_date: date = Query(..., alias="startDate"),
    end_date: date = Query(..., alias="endDate"),
    service: ProductivityService = Depends(get_productivity_service),
) -> list[IdleTimeLogOut]:
    rows = service.get_idle_time_range(employee_id, start_date, end_date)
    return [IdleTimeLogOut(**row) for row in rows]
