from datetime import date as date_
from datetime import datetime
from typing import Literal
from uuid import UUID

from . import CamelModel

EventType = Literal['check_in', 'check_out', 'break_start', 'break_end']
BreakType = Literal['LUNCH_ZUHAR', 'TEA_ASAR', 'MANUAL', 'WASHROOM']
TriggeredBy = Literal['manual', 'scheduled']

# NOT_CHECKED_IN | CHECKED_OUT | ON_BREAK | ACTIVE_JABBER | ACTIVE_WILDIX |
# ACTIVE | IDLE | AWAY
ShiftStatus = str


class CheckInOut(CamelModel):
    employee_id: UUID


class ShiftEventOut(CamelModel):
    id: UUID
    employee_id: UUID
    event_type: EventType
    occurred_at: datetime
    break_type: BreakType | None = None
    triggered_by: TriggeredBy
    label: str | None = None
    created_at: datetime


class BreakStatusOut(CamelModel):
    employee_id: UUID
    on_break: bool
    break_type: BreakType | None = None
    triggered_by: TriggeredBy | None = None
    break_started_at: datetime | None = None


class ComplianceBreakdownOut(CamelModel):
    """Where Compliance Score's points were lost, if any - see
    ProductivityService._compute_compliance_score()."""

    idle_penalty_points: float
    late_return_penalty_points: float
    washroom_penalty_points: float
    idle_seconds: int
    idle_threshold_seconds: int
    late_return_count: int
    washroom_break_count: int
    washroom_over_limit_count: int
    washroom_over_duration_count: int


class ProductivityWeightsOut(CamelModel):
    """The weights actually applied to this score, from productivity_config
    at calculation time - lets the UI show "40% Attendance + 30% App Focus
    + 30% Compliance" using the real configured numbers, not a hardcoded
    guess that could drift from what was actually used."""

    attendance_weight: float
    app_focus_weight: float
    compliance_weight: float
    call_efficiency_weight: float


class ShiftSummaryOut(CamelModel):
    """THE single authoritative calculation for one employee/day - see
    ProductivityService.get_shift_summary(). Every dashboard component that
    shows active/idle/break/shift-duration/camera/status for an employee
    reads this same shape (directly, or via the all-employees idle-time
    summary that delegates to the same function).

    productivity_percentage is the unified Overall Productivity score
    (Attendance Ratio + App Focus Score + Compliance Score, weighted) - see
    ProductivityService._compute_overall_productivity(). The three
    sub-scores and the compliance penalty breakdown are exposed below for
    anywhere that wants to show the full calculation, not just the final
    number."""

    employee_id: UUID
    date: date_
    is_checked_in: bool
    is_on_break: bool
    shift_duration_seconds: int
    break_seconds: int
    active_seconds: int
    idle_seconds: int
    jabber_seconds: int
    wildix_seconds: int
    productivity_percentage: float
    attendance_ratio: float
    app_focus_score: float
    compliance_score: float
    compliance_breakdown: ComplianceBreakdownOut
    weights_used: ProductivityWeightsOut
    status: ShiftStatus
    camera_active_seconds: int
    input_active_seconds: int
    combined_active_seconds: int
    idle_away_seconds: int
    sample_count: int


class TriggerScheduledBreakIn(CamelModel):
    """Dev/test hook - calls the exact same functions the cron scheduler
    invokes, so this is a true test of production logic, not a parallel
    code path. Not gated behind auth today, matching every other endpoint
    in this service (see presence.py's set_global_config docstring) -
    acceptable for this dev/internal tool, revisit if this service is ever
    exposed outside a trusted network."""

    break_key: str
    action: Literal['start', 'end']
