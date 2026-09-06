from typing import Any

from fastapi import Depends

from .db import get_supabase_client
from .services.productivity import ProductivityService


def get_productivity_service(client: Any = Depends(get_supabase_client)) -> ProductivityService:
    return ProductivityService(client)
