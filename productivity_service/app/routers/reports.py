from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ..deps import get_productivity_service
from ..schemas.reports import DailyReportRowOut, ReportRowsOut
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/attendance", response_model=ReportRowsOut)
def get_attendance_report(
    start_date: date = Query(..., alias="startDate"),
    end_date: date = Query(..., alias="endDate"),
    employee_id: UUID | None = Query(default=None, alias="employeeId"),
    service: ProductivityService = Depends(get_productivity_service),
) -> ReportRowsOut:
    rows = service.get_report_rows(start_date, end_date, employee_id)
    return ReportRowsOut(rows=[DailyReportRowOut(**row) for row in rows])


@router.get("/productivity", response_model=ReportRowsOut)
def get_productivity_report(
    start_date: date = Query(..., alias="startDate"),
    end_date: date = Query(..., alias="endDate"),
    employee_id: UUID | None = Query(default=None, alias="employeeId"),
    service: ProductivityService = Depends(get_productivity_service),
) -> ReportRowsOut:
    # Same underlying rows as the attendance report - the two PDFs just
    # render different columns from the same get_daily_report_row() output,
    # so both endpoints stay provably consistent with each other and with
    # what the Idle Time page shows for the same dates.
    rows = service.get_report_rows(start_date, end_date, employee_id)
    return ReportRowsOut(rows=[DailyReportRowOut(**row) for row in rows])
