"""Fire-and-forget bridge from productivity_service (where check-in/
check-out/idle/break events actually happen) to the NestJS backend (where
Socket.IO delivery and the Notification table live). See
backend/src/notifications/notifications.controller.ts's
POST /notifications/system-event for the receiving end.

Dispatched on a background thread, not awaited by the caller - a
notification failing to send (backend down, network hiccup) must never
block or fail the real operation (check-in/check-out/idle logging) that
triggered it. Every exception is caught and logged, never raised.
"""
from __future__ import annotations

import logging
import threading

import httpx

from ..config import get_settings

logger = logging.getLogger("productivity_service")

REQUEST_TIMEOUT_SECONDS = 3.0


def _post(payload: dict) -> None:
    url = f"{get_settings().notifications_backend_url}/api/v1/notifications/system-event"
    try:
        response = httpx.post(url, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
        if not response.is_success:
            logger.warning(
                "[notify_client] Backend rejected system-event (HTTP %s): %s",
                response.status_code, response.text[:300],
            )
    except Exception:
        logger.warning("[notify_client] Failed to reach notifications backend at %s", url, exc_info=True)


def notify_system_event(
    employee_email: str,
    notification_type: str,
    admin_title: str,
    admin_message: str,
    employee_title: str | None = None,
    employee_message: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Reports a real event to the NestJS notifications bridge.

    admin_message always creates an ADMIN-scoped notification (visible to
    every manager in the employee's organization). employee_message, if
    given, ALSO creates a separate EMPLOYEE-scoped notification visible
    only to that one employee - e.g. a check-in fires both "Ayesha Khan
    checked in at 9:02 AM" (admins) and "You checked in successfully"
    (just her), not the same message shown twice to different audiences.
    """
    if not employee_email:
        logger.warning("[notify_client] Skipping %s notification - no employee email available", notification_type)
        return

    payload = {
        "employeeEmail": employee_email,
        "type": notification_type,
        "adminTitle": admin_title,
        "adminMessage": admin_message,
        "employeeTitle": employee_title,
        "employeeMessage": employee_message,
        "metadata": metadata or {},
    }
    threading.Thread(target=_post, args=(payload,), daemon=True).start()
