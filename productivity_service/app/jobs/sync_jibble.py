"""
Polling sync job - Jibble has no confirmed webhook support, so this pulls
time entries updated since the last sync and upserts them into
synced_time_entries. Safe to run concurrently or re-run: each entry is
deduplicated on jibble_entry_id (a unique column), so re-processing the
same window just re-writes the same rows instead of duplicating them.

Run manually (one-shot):
    cd productivity_service && python -m app.jobs.sync_jibble

Runs automatically every JIBBLE_SYNC_INTERVAL_MINUTES via APScheduler,
wired up in app.main (only when JIBBLE_CLIENT_ID/SECRET are configured).
Also triggerable on demand via POST /api/sync/jibble - see app.routers.sync.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..db import get_supabase_client
from ..services.jibble_client import get_jibble_client
from ..services.productivity import ProductivityService

logger = logging.getLogger("jibble_sync")

SYNC_STATE_KEY = "jibble_time_entries"
# First-ever run has no sync_state row yet - pull everything since a fixed
# point in the past rather than "now" so nothing is missed.
DEFAULT_SYNC_LOOKBACK = datetime(2020, 1, 1, tzinfo=timezone.utc)


def run_sync() -> dict:
    service = ProductivityService(get_supabase_client())
    jibble = get_jibble_client()

    last_synced_at = service.get_sync_state(SYNC_STATE_KEY) or DEFAULT_SYNC_LOOKBACK
    sync_started_at = datetime.now(timezone.utc)

    entries = jibble.get_time_entries(since=last_synced_at)

    upserted = 0
    tasks_created = 0
    skipped = 0

    for entry in entries:
        try:
            result = service.upsert_synced_time_entry(entry)
        except Exception:
            skipped += 1
            logger.exception("Skipping bad Jibble time entry, continuing batch: %r", entry)
            continue

        upserted += 1
        if result.get("task_created"):
            tasks_created += 1

    # Only advance the watermark after a successful pass through the batch,
    # so a hard failure before this point causes the next run to retry the
    # same window rather than silently skipping it.
    service.set_sync_state(SYNC_STATE_KEY, sync_started_at)

    summary = {
        "pulled": len(entries),
        "upserted": upserted,
        "tasks_created": tasks_created,
        "skipped": skipped,
        "synced_at": sync_started_at.isoformat(),
    }
    logger.info("Jibble sync complete: %s", summary)
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_sync()
