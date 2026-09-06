from fastapi import APIRouter, Depends

from ..deps import get_productivity_service
from ..schemas.dashboard import DashboardSummaryOut
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummaryOut)
def get_dashboard_summary(
    service: ProductivityService = Depends(get_productivity_service),
) -> DashboardSummaryOut:
    return DashboardSummaryOut(**service.get_dashboard_summary())
