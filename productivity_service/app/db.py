import logging
import time
from functools import lru_cache, wraps
from typing import Any

from .config import get_settings

logger = logging.getLogger("productivity_service")

# get_shift_summary makes several sequential calls over the same shared
# HTTP/2 (multiplexed) session per request (shift_events, idle_time_logs,
# presence_logs), so a single dead/dying connection can be hit by more than
# one of them in the same request - one immediate retry wasn't always
# enough (observed in practice: retry landed on the same connection before
# the pool had evicted it). A few attempts with a short, increasing delay
# gives the pool time to actually replace the dead connection between tries.
MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 0.15


def _patch_stale_connection_retry(postgrest_session: Any) -> None:
    """Retries when the pooled Supabase connection is dead on arrival.

    The desktop client polls presence/idle endpoints every ~20-90s. Supabase's
    pooler (and httpx's own keep-alive pool) silently closes connections that
    sit idle between polls, so the *next* request picks a dead connection from
    the pool and httpx raises RemoteProtocolError("Server disconnected") /
    ConnectError before the request body ever reaches the server - nothing was
    processed server-side, so retrying (httpx hands a retry a fresh
    connection once the pool evicts the dead one) is safe, including for
    inserts.
    """
    import httpx

    retryable = (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError)
    original_request = postgrest_session.request

    @wraps(original_request)
    def request_with_retry(*args: Any, **kwargs: Any) -> Any:
        last_exc: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                return original_request(*args, **kwargs)
            except retryable as exc:
                last_exc = exc
                logger.warning(
                    "Supabase request hit a stale pooled connection (%s), attempt %d/%d",
                    exc, attempt + 1, MAX_ATTEMPTS,
                )
                if attempt + 1 < MAX_ATTEMPTS:
                    time.sleep(RETRY_DELAY_SECONDS * (attempt + 1))
        raise last_exc

    postgrest_session.request = request_with_retry


@lru_cache
def get_supabase_client() -> Any:
    """Lazily creates a cached Supabase client.

    Imported lazily so unit tests that don't touch the database (e.g. the
    pure productivity-formula tests) don't require the `supabase` package
    or real credentials to be importable.
    """
    from supabase import create_client

    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_key)
    _patch_stale_connection_retry(client.postgrest.session)
    return client
