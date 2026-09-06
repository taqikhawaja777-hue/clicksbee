from datetime import date as date_
from typing import Literal
from uuid import UUID

from . import CamelModel

AttendanceStatus = Literal['PRESENT', 'ABSENT']


class DailyReportRowOut(CamelModel):
    """One employee, one calendar day - the day-scoped, multi-session-
    merged figures used by the Attendance and Productivity report PDFs.
    See ProductivityService.get_daily_report_row()."""

    employee_id: UUID
    employee_name: str
    date: date_
    attendance_status: AttendanceStatus
    check_in_at: str | None = None
    check_out_at: str | None = None
    still_checked_in: bool
    shift_duration_seconds: int
    break_seconds: int
    active_seconds: int
    idle_seconds: int
    jabber_seconds: int
    wildix_seconds: int
    productivity_percentage: float
    camera_active_seconds: int
    combined_active_seconds: int


class ReportRowsOut(CamelModel):
    rows: list[DailyReportRowOut]
