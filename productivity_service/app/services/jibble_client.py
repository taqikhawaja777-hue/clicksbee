"""
All Jibble HTTP calls go through this module - nothing else calls Jibble
directly.

What's verified vs. best-effort, so it's obvious what to double-check:
- VERIFIED: the OAuth2 client-credentials token endpoint is
  https://identity.prod.jibble.io/connect/token (Jibble's own identity
  service, corroborated by multiple third-party integration docs).
- VERIFIED: Jibble splits its REST API across multiple hosts, including
  workspace.prod.jibble.io/v1 (members, activities) and
  time-tracking.prod.jibble.io/v1 (time entries).
- BEST-EFFORT: docs.api.jibble.io itself is a JS-rendered reference site
  this environment could not crawl, so the exact resource paths below
  (organizations/{id}/members, .../activities, .../time-entries) and the
  field names read via `_pick(...)` are a reconstruction from a
  third-party open-source Jibble client, not a page fetched from Jibble's
  own docs. Confirm both against a live test call (Organization Settings >
  API Keys) or Jibble support before depending on this in production, and
  adjust the `_org_path` resource names / `_pick` candidate keys if they
  differ - everything is centralized here so that's a small, local change.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

import httpx

from ..config import get_settings

logger = logging.getLogger("jibble_client")


def _pick(entry: dict, *keys: str) -> Any:
    """First present, non-None value among candidate key spellings.

    Used because the exact field names on Jibble's time entry payloads
    aren't confirmed (see module docstring) - this keeps the client
    tolerant of the couple of most likely spellings instead of hard-failing
    every record if the guess is slightly off.
    """
    for key in keys:
        if key in entry and entry[key] is not None:
            return entry[key]
    return None


class JibbleClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_url: str,
        workspace_base_url: str,
        time_tracking_base_url: str,
        organization_id: str = "",
    ):
        if not client_id or not client_secret:
            raise RuntimeError(
                "JIBBLE_CLIENT_ID / JIBBLE_CLIENT_SECRET are not configured"
            )
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = token_url
        self.workspace_base_url = workspace_base_url.rstrip("/")
        self.time_tracking_base_url = time_tracking_base_url.rstrip("/")
        self.organization_id = organization_id

        self._access_token: str | None = None
        self._token_expires_at: float = 0.0

    def _get_access_token(self) -> str:
        if self._access_token and time.time() < self._token_expires_at - 30:
            return self._access_token

        response = httpx.post(
            self.token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15.0,
        )
        response.raise_for_status()
        payload = response.json()

        self._access_token = payload["access_token"]
        self._token_expires_at = time.time() + payload.get("expires_in", 3600)
        return self._access_token

    def _get(self, base_url: str, path: str, params: dict[str, Any] | None = None) -> list[dict]:
        token = self._get_access_token()
        response = httpx.get(
            f"{base_url}{path}",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        response.raise_for_status()
        body = response.json()
        # OData-style responses wrap the array in "value"; tolerate a bare
        # list too in case a given endpoint doesn't wrap it.
        if isinstance(body, dict):
            return body.get("value", [])
        return body

    def _org_path(self, resource: str) -> str:
        if self.organization_id:
            return f"/organizations/{self.organization_id}/{resource}"
        return f"/{resource}"

    def get_members(self) -> list[dict]:
        return self._get(
            self.workspace_base_url,
            self._org_path("members"),
            params={"$select": "id,fullName,email"},
        )

    def get_activities(self) -> list[dict]:
        return self._get(
            self.workspace_base_url,
            self._org_path("activities"),
            params={"$select": "id,name"},
        )

    def get_time_entries(self, since: datetime) -> list[dict]:
        """Time entries updated since `since`, via OData $filter so only
        new/changed records are pulled each sync."""
        since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")
        return self._get(
            self.time_tracking_base_url,
            self._org_path("time-entries"),
            params={
                "$filter": f"updatedAt ge {since_iso}",
                "$orderby": "updatedAt asc",
            },
        )

    def find_activity_by_name(self, name: str) -> dict | None:
        """Look up an existing Jibble activity by exact (case-insensitive)
        name match. There's no confirmed Jibble endpoint for *creating*
        activities via this API, so task creation only looks up a mapping -
        it doesn't try to create one in Jibble. See TasksService.create_task.
        """
        normalized = name.strip().lower()
        for activity in self.get_activities():
            activity_name = _pick(activity, "name", "activityName")
            if activity_name and activity_name.strip().lower() == normalized:
                return activity
        return None


_client: JibbleClient | None = None


def get_jibble_client() -> JibbleClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = JibbleClient(
            client_id=settings.jibble_client_id,
            client_secret=settings.jibble_client_secret,
            token_url=settings.jibble_token_url,
            workspace_base_url=settings.jibble_workspace_base_url,
            time_tracking_base_url=settings.jibble_time_tracking_base_url,
            organization_id=settings.jibble_organization_id,
        )
    return _client
