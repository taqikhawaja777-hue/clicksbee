from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import get_productivity_service
from ..services.productivity import KARACHI_TZ
from ..schemas.presence import (
    CameraConsentIn,
    CameraConsentOut,
    CameraMonitoringConfigOut,
    EmployeeCameraConfigIn,
    GlobalCameraConfigIn,
    PresenceLogIn,
    PresenceLogOut,
    PresenceSummaryOut,
)
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/presence", tags=["presence"])


@router.post("/consent", response_model=CameraConsentOut, status_code=201)
def record_consent(
    payload: CameraConsentIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> CameraConsentOut:
    """Logs both accept and decline - an audit trail of what was disclosed
    and when, not just a single yes/no flag."""
    row = service.record_camera_consent(payload.employee_id, payload.consented)
    return CameraConsentOut(**row)


@router.get("/consent/{employee_id}", response_model=CameraConsentOut | None)
def get_consent(
    employee_id: UUID,
    service: ProductivityService = Depends(get_productivity_service),
) -> CameraConsentOut | None:
    row = service.get_latest_camera_consent(employee_id)
    return CameraConsentOut(**row) if row else None


@router.get("/config/global")
def get_global_config(
    service: ProductivityService = Depends(get_productivity_service),
) -> dict:
    return {"globallyEnabled": service.get_globally_enabled()}


@router.get("/config/{employee_id}", response_model=CameraMonitoringConfigOut)
def get_config(
    employee_id: UUID,
    service: ProductivityService = Depends(get_productivity_service),
) -> CameraMonitoringConfigOut:
    """Effective enablement = globally_enabled AND employee_enabled. The
    desktop client checks this before ever showing the consent modal or
    touching the webcam."""
    return CameraMonitoringConfigOut(**service.get_camera_config(employee_id))


@router.put("/config/global", status_code=204)
def set_global_config(
    payload: GlobalCameraConfigIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> None:
    """Admin-only kill switch. Like every other endpoint in this service,
    there's no server-side role check yet - access control today is just
    the Manager-only sidebar item in the React app, same as the rest of
    productivity_service's admin-ish endpoints (e.g. employees/register)."""
    service.set_globally_enabled(payload.globally_enabled)


@router.put("/config/{employee_id}", response_model=CameraMonitoringConfigOut)
def set_employee_config(
    employee_id: UUID,
    payload: EmployeeCameraConfigIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> CameraMonitoringConfigOut:
    service.set_employee_camera_enabled(employee_id, payload.enabled)
    return CameraMonitoringConfigOut(**service.get_camera_config(employee_id))


@router.post("/log", response_model=PresenceLogOut, status_code=201)
def log_presence(
    payload: PresenceLogIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> PresenceLogOut:
    try:
        row = service.insert_presence_log(payload)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return PresenceLogOut(**row)


@router.get("/summary/{employee_id}", response_model=PresenceSummaryOut)
def get_summary(
    employee_id: UUID,
    # get_presence_summary() now builds its day-range query in Asia/Karachi
    # (the org's fixed reference timezone for "what day is it," shared with
    # shift_events/idle_time_logs - see KARACHI_TZ in productivity.py), so
    # the default here must match. It used to default to UTC-today, which
    # was itself a fix for defaulting to the server's *local* system date -
    # but once get_shift_summary started calling this function with a
    # Karachi-local day, a UTC default here would disagree with every other
    # caller for several hours around each local midnight (confirmed: this
    # exact mismatch made the Presence Verification card show "no checks
    # logged" while checks were actively landing).
    on_date: date = Query(default_factory=lambda: datetime.now(KARACHI_TZ).date(), alias="date"),
    service: ProductivityService = Depends(get_productivity_service),
) -> PresenceSummaryOut:
    return PresenceSummaryOut(**service.get_presence_summary(employee_id, on_date))
