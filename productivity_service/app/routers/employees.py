from fastapi import APIRouter, Depends

from ..deps import get_productivity_service
from ..schemas.employee import ActiveEmployeeOut, EmployeeCreate, EmployeeOut
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.post("/register", response_model=EmployeeOut, status_code=201)
def register_employee(
    payload: EmployeeCreate,
    service: ProductivityService = Depends(get_productivity_service),
) -> EmployeeOut:
    """Bootstrap helper: creates an employee row (this service owns its own
    employee records, separate from the main app's user store), or returns
    the existing one if this email is already registered - idempotent so
    the desktop app's idle-time tracker can safely call this on every
    launch. Optionally takes a jibble_member_id up front; if omitted, an
    admin can set it later directly on the row to enable Jibble sync for
    that employee."""
    employee = service.get_or_create_employee(payload.full_name, payload.email, payload.jibble_member_id, payload.role)
    return EmployeeOut(**employee)


@router.get("/active", response_model=list[ActiveEmployeeOut])
def get_active_employees(
    service: ProductivityService = Depends(get_productivity_service),
) -> list[ActiveEmployeeOut]:
    return [ActiveEmployeeOut(**row) for row in service.get_active_employees()]


@router.get("", response_model=list[EmployeeOut])
def list_employees(
    service: ProductivityService = Depends(get_productivity_service),
) -> list[EmployeeOut]:
    """All registered employees - drives the admin-only camera-monitoring
    per-employee toggle list on the settings page."""
    return [EmployeeOut(**row) for row in service.list_employees()]
