from . import CamelModel


class DashboardSummaryOut(CamelModel):
    avg_productivity: float
    active_employee_count: int
    tickets_generated_today: int
