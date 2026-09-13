from fastapi import APIRouter, Depends

from ..deps import get_productivity_service
from ..schemas.productivity_config import ProductivityConfigIn, ProductivityConfigOut
from ..services.productivity import ProductivityService

router = APIRouter(prefix="/api/productivity-config", tags=["productivity-config"])


@router.get("", response_model=ProductivityConfigOut)
def get_config(
    service: ProductivityService = Depends(get_productivity_service),
) -> ProductivityConfigOut:
    """The Overall Productivity formula's current weights/thresholds -
    lets a settings UI (or this session's manual verification) show and
    edit the real numbers actually driving the calculation."""
    return ProductivityConfigOut(**service.get_productivity_config())


@router.put("", response_model=ProductivityConfigOut)
def update_config(
    payload: ProductivityConfigIn,
    service: ProductivityService = Depends(get_productivity_service),
) -> ProductivityConfigOut:
    """Adjusting the formula's weights/thresholds is a data change here,
    not a code change - like every other admin-ish endpoint in this
    service, there's no server-side role check yet (see presence.py's
    set_global_config docstring)."""
    updates = payload.model_dump(exclude_none=True)
    return ProductivityConfigOut(**service.update_productivity_config(updates))
