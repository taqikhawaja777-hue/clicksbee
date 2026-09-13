from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ..deps import get_productivity_service
from ..schemas.idle_time import EmployeeIdleStatusOut, IdleTimeLogIn, IdleTimeLogOut, IdleTimeSummaryOut
from ..services.productivity import ProductivityService
from ..services.notify_client import notify_system_event

router = APIRouter(prefix="/api/idle-time", tags=["idle-time"])


@router.post("/log", response_model=IdleTimeLogOut, status_code=201)
def log_idle_time(
    payload: IdleTimeLogIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> IdleTimeLogOut:
    # Read the pre-upsert value so we can tell whether THIS update is what
    # just crossed the threshold, vs. the employee having already been over
    # it for a while - idle_seconds is a whole-day cumulative running total
    # the client re-posts every poll, so without this check every single
    # poll after the first crossing would fire another notification.
    previous_rows = service.get_idle_time_range(payload.employee_id, payload.date, payload.date)
    previous_idle_seconds = previous_rows[0]["idle_seconds"] if previous_rows else 0

    row = service.upsert_idle_time_log(payload)

    config = service.get_productivity_config()
    threshold = config["idle_penalty_threshold_seconds"]
    if previous_idle_seconds < threshold <= payload.idle_seconds:
        employee = service.get_employee(payload.employee_id)
        if employee:
            minutes = threshold // 60
            notify_system_event(
                employee_email=employee.get("email"),
                notification_type="IDLE_ALERT",
                admin_title="Employee Idle Alert",
                admin_message=f"{employee.get('full_name')} has been idle for {minutes}+ minutes",
                employee_title="Idle Time Alert",
                employee_message=f"You are approaching your daily idle time limit ({minutes}+ minutes idle today)",
            )

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
