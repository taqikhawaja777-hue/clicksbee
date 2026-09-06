from datetime import datetime

from . import CamelModel


class JibbleSyncSummary(CamelModel):
    pulled: int
    upserted: int
    tasks_created: int
    skipped: int
    synced_at: datetime
