from fastapi import APIRouter

from ..jobs.sync_jibble import run_sync
from ..schemas.sync import JibbleSyncSummary

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/jibble", response_model=JibbleSyncSummary)
def trigger_jibble_sync() -> JibbleSyncSummary:
    """Manual trigger for testing - runs the same sync the scheduler runs."""
    summary = run_sync()
    return JibbleSyncSummary(**summary)
