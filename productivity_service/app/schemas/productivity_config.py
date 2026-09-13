from . import CamelModel


class ProductivityConfigOut(CamelModel):
    """The Overall Productivity formula's configurable weights and
    compliance thresholds - see the productivity_config table (migration
    008_overall_productivity.sql) and ProductivityService.get_productivity_config()."""

    attendance_weight: float
    app_focus_weight: float
    compliance_weight: float
    call_efficiency_weight: float
    idle_penalty_threshold_seconds: int
    idle_penalty_points_per_minute: float
    idle_penalty_max_points: float
    break_grace_period_seconds: int
    late_return_penalty_points: float
    washroom_daily_limit: int
    washroom_minutes_limit: float
    washroom_penalty_points: float


class ProductivityConfigIn(CamelModel):
    """Partial update - every field optional, only what's provided changes."""

    attendance_weight: float | None = None
    app_focus_weight: float | None = None
    compliance_weight: float | None = None
    call_efficiency_weight: float | None = None
    idle_penalty_threshold_seconds: int | None = None
    idle_penalty_points_per_minute: float | None = None
    idle_penalty_max_points: float | None = None
    break_grace_period_seconds: int | None = None
    late_return_penalty_points: float | None = None
    washroom_daily_limit: int | None = None
    washroom_minutes_limit: float | None = None
    washroom_penalty_points: float | None = None
