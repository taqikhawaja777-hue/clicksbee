from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from ..schemas.activity import ActivityEventIn
from ..schemas.idle_time import IdleTimeLogIn
from ..schemas.presence import PresenceLogIn
from .jibble_client import _pick

logger = logging.getLogger("productivity_service")

# The org's fixed reference timezone for "what day is it" throughout this
# feature (shift_events, idle_time_logs' client-local date, and presence
# summaries all need to agree on the same calendar-day boundaries, or a
# lookup for "today" in one can silently miss data the others correctly
# find - exactly what happened when get_presence_summary used UTC day
# boundaries while get_shift_summary passed it a Karachi-local day: for
# several hours around each local midnight the two disagree on what
# "today" even means). Matches the Zuhar/Asar-named scheduled break windows.
KARACHI_TZ = ZoneInfo("Asia/Karachi")

# A row not refreshed within this window is treated as "AWAY" (desktop
# client closed/offline) on the live status card, rather than trusting a
# possibly hours-stale last_active_app/last_is_idle snapshot. Comfortably
# above the 1-2 minute batching interval the client posts on.
IDLE_STATUS_AWAY_THRESHOLD_SECONDS = 240

# Must match the client's presence-check poll cadence (admin_dashboard's
# presenceDetector.ts) - presence_logs stores one row per check with no
# duration field, so seconds-per-status are approximated as row_count *
# this constant rather than computed from explicit start/end timestamps.
PRESENCE_POLL_INTERVAL_SECONDS = 15

# After a break ends (scheduled or manual), the employee's displayed status
# is pinned to ACTIVE for this long regardless of actual input, so idle
# detection doesn't immediately flag someone who just got back to their
# desk. Only affects the `status` string returned by get_shift_summary -
# it never touches idle_seconds/active_seconds themselves.
GRACE_PERIOD_SECONDS = 120

# How fresh the latest presence_logs sample must be to drive the
# camera-aware status shown on "Today, per employee" - checked/refreshed
# on this cadence (well above the client's own 20s presence-check poll,
# so a couple of skipped ticks doesn't immediately fall back to the
# input-only status). Older than this (or no camera data at all, e.g. the
# employee never enabled/consented to camera monitoring) falls back to
# the existing input-only _idle_status() logic.
CAMERA_STATUS_FRESHNESS_SECONDS = 120


def compute_score(active_ms: int, idle_ms: int) -> float:
    """Legacy active/idle formula from the own-capture-agent flow.

    No longer called by the live endpoints (see `calculate_productivity`
    below, which Jibble-sourced tracking uses instead) - kept because the
    `/api/activity/events` ingestion endpoint and its own-capture-agent data
    still exist and this is the only thing that ever scored them.
    """
    total = active_ms + idle_ms
    if total <= 0:
        return 0.0
    return round((active_ms / total) * 100, 2)


def calculate_productivity(
    tracked_ms: int,
    estimated_minutes: int | None = None,
    employee_clocked_ms_today: int = 0,
) -> float:
    """The one place the Jibble-based productivity formula lives.

    Used by both the live per-task productivity endpoint and the
    close-session ticket calculation so the two never drift apart.

    Two modes (swap which one is "active" here if the product decision
    changes - it's the only place this needs to happen):
      1. Estimate-based (used when the task has `estimated_minutes` set):
         tracked time against the task's own estimate, capped at 100 so an
         overrun doesn't produce a score above 100%.
      2. Time-on-task fallback (no estimate set): tracked time as a share
         of everything the employee clocked today via Jibble.
    """
    if tracked_ms <= 0:
        return 0.0

    if estimated_minutes and estimated_minutes > 0:
        estimated_ms = estimated_minutes * 60_000
        return min(100.0, round((tracked_ms / estimated_ms) * 100, 2))

    if employee_clocked_ms_today <= 0:
        return 0.0
    return round((tracked_ms / employee_clocked_ms_today) * 100, 2)


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class ProductivityService:
    """Thin wrapper around the Supabase client for productivity-tracking data.

    Route handlers should never call the Supabase client directly - they go
    through this service so the query/aggregation logic lives in one place.
    """

    def __init__(self, client: Any):
        self.client = client

    # ---- employees ----------------------------------------------------

    def get_employee(self, employee_id: UUID) -> dict | None:
        resp = self.client.table("employees").select("*").eq("id", str(employee_id)).execute()
        rows = resp.data or []
        return rows[0] if rows else None

    def list_employees(self) -> list[dict]:
        resp = self.client.table("employees").select("*").order("full_name").execute()
        return resp.data or []

    def get_employee_by_jibble_member_id(self, jibble_member_id: str) -> dict | None:
        resp = (
            self.client.table("employees")
            .select("*")
            .eq("jibble_member_id", jibble_member_id)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def get_employee_by_email(self, email: str) -> dict | None:
        resp = self.client.table("employees").select("*").eq("email", email).execute()
        rows = resp.data or []
        return rows[0] if rows else None

    def create_employee(
        self, full_name: str, email: str, jibble_member_id: str | None = None, role: str = "EMPLOYEE"
    ) -> dict:
        row = {"full_name": full_name, "email": email, "jibble_member_id": jibble_member_id, "role": role}
        try:
            resp = self.client.table("employees").insert(row).execute()
        except Exception as exc:
            # Falls back to writing without `role` if migration
            # 007_employees_role.sql hasn't been applied yet - registration
            # is a critical path (runs on every desktop app launch) that
            # shouldn't go down because of an optional, filtering-only
            # column. Once the migration lands, this branch stops firing.
            if "role" not in str(exc):
                raise
            logger.warning(
                "employees insert failed on 'role' column (migration "
                "007_employees_role.sql not applied yet?) - retrying without it: %s", exc,
            )
            row.pop("role", None)
            resp = self.client.table("employees").insert(row).execute()
        return resp.data[0]

    def get_or_create_employee(
        self, full_name: str, email: str, jibble_member_id: str | None = None, role: str = "EMPLOYEE"
    ) -> dict:
        """Idempotent registration keyed on email. `email` is unique on the
        table, so registering the same person twice (e.g. the desktop app
        bootstrapping its idle-time tracker on every launch) returns the
        existing row instead of failing on the unique constraint. `role` is
        only applied on first creation - an already-registered person's
        role is never silently overwritten by a later login."""
        existing = self.get_employee_by_email(email)
        if existing:
            return existing
        return self.create_employee(full_name, email, jibble_member_id, role)

    # ---- tasks -----------------------------------------------------------

    def get_task(self, task_id: UUID) -> dict | None:
        resp = self.client.table("tasks").select("*").eq("id", str(task_id)).execute()
        rows = resp.data or []
        return rows[0] if rows else None

    def create_task(
        self,
        employee_id: UUID,
        title: str,
        estimated_minutes: int | None,
        jibble_activity_id: str | None = None,
    ) -> dict:
        resp = self.client.table("tasks").insert(
            {
                "employee_id": str(employee_id),
                "title": title,
                "estimated_minutes": estimated_minutes,
                "jibble_activity_id": jibble_activity_id,
            }
        ).execute()
        return resp.data[0]

    def find_task_by_jibble_activity(self, employee_id: str, jibble_activity_id: str) -> dict | None:
        """Prefer an in-progress task for this employee+activity; otherwise
        fall back to the most recent task for that activity (so a re-synced
        entry for an already-closed task still lands on the same task
        instead of spawning a duplicate)."""
        in_progress = (
            self.client.table("tasks")
            .select("*")
            .eq("employee_id", employee_id)
            .eq("jibble_activity_id", jibble_activity_id)
            .eq("status", "in_progress")
            .execute()
        )
        rows = in_progress.data or []
        if rows:
            return rows[0]

        any_task = (
            self.client.table("tasks")
            .select("*")
            .eq("employee_id", employee_id)
            .eq("jibble_activity_id", jibble_activity_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = any_task.data or []
        return rows[0] if rows else None

    # ---- activity events (own-capture-agent flow; superseded by Jibble
    # sync below for scoring, kept as-is since nothing asked to remove it)

    def insert_activity_events(self, events: list[ActivityEventIn]) -> int:
        if not events:
            return 0
        rows = [
            {
                "task_id": str(event.task_id),
                "employee_id": str(event.employee_id),
                "app_name": event.app_name,
                "is_idle": event.is_idle,
                "event_start": event.event_start.isoformat(),
                "event_end": event.event_end.isoformat(),
                "duration_ms": event.duration_ms,
            }
            for event in events
        ]
        resp = self.client.table("activity_events").insert(rows).execute()
        return len(resp.data or [])

    def get_task_events(self, task_id: UUID) -> list[dict]:
        resp = self.client.table("activity_events").select("*").eq("task_id", str(task_id)).execute()
        return resp.data or []

    @staticmethod
    def aggregate_events(events: list[dict]) -> tuple[int, int, list[dict]]:
        """Reduce a task's activity_events rows into (active_ms, idle_ms, app_breakdown)."""
        active_ms = 0
        idle_ms = 0
        app_totals: dict[str, int] = {}

        for event in events:
            duration = event["duration_ms"]
            if event["is_idle"]:
                idle_ms += duration
            else:
                active_ms += duration
                app_name = event.get("app_name") or "Unknown"
                app_totals[app_name] = app_totals.get(app_name, 0) + duration

        app_breakdown = [
            {"app_name": name, "ms": ms}
            for name, ms in sorted(app_totals.items(), key=lambda item: item[1], reverse=True)
        ]
        return active_ms, idle_ms, app_breakdown

    # ---- Jibble time entries -------------------------------------------

    @staticmethod
    def _entry_duration_ms(row: dict) -> int:
        if row.get("duration_ms") is not None:
            return int(row["duration_ms"])
        start, end = row.get("entry_start"), row.get("entry_end")
        if start and end:
            return int((_parse_iso(end) - _parse_iso(start)).total_seconds() * 1000)
        return 0

    def get_tracked_ms_for_task(self, task_id: UUID) -> int:
        resp = (
            self.client.table("synced_time_entries")
            .select("duration_ms,entry_start,entry_end")
            .eq("task_id", str(task_id))
            .execute()
        )
        return sum(self._entry_duration_ms(row) for row in (resp.data or []))

    def get_employee_clocked_ms_today(self, employee_id: UUID, day: date) -> int:
        start = datetime.combine(day, time.min, tzinfo=timezone.utc).isoformat()
        end = datetime.combine(day, time.max, tzinfo=timezone.utc).isoformat()
        resp = (
            self.client.table("synced_time_entries")
            .select("duration_ms,entry_start,entry_end")
            .eq("employee_id", str(employee_id))
            .gte("entry_start", start)
            .lte("entry_start", end)
            .execute()
        )
        return sum(self._entry_duration_ms(row) for row in (resp.data or []))

    def get_task_productivity(self, task: dict) -> tuple[int, float]:
        """Live productivity for a task, sourced from synced_time_entries."""
        task_id = UUID(task["id"])
        tracked_ms = self.get_tracked_ms_for_task(task_id)
        estimated_minutes = task.get("estimated_minutes")

        if estimated_minutes and estimated_minutes > 0:
            score = calculate_productivity(tracked_ms, estimated_minutes=estimated_minutes)
        else:
            employee_id = UUID(task["employee_id"])
            clocked_today = self.get_employee_clocked_ms_today(
                employee_id, datetime.now(timezone.utc).date()
            )
            score = calculate_productivity(tracked_ms, employee_clocked_ms_today=clocked_today)

        return tracked_ms, score

    # ---- close session / ticket ---------------------------------------

    def close_task(self, task_id: UUID, task: dict) -> dict:
        tracked_ms, score = self.get_task_productivity(task)

        ticket_row = {
            "task_id": str(task_id),
            "employee_id": task["employee_id"],
            "started_at": task["created_at"],
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "tracked_ms": tracked_ms,
            "productivity_score": score,
            "source": "jibble",
        }

        ticket_resp = self.client.table("tickets").insert(ticket_row).execute()
        ticket = self._normalize_ticket_row(ticket_resp.data[0])

        self.client.table("tasks").update({"status": "completed"}).eq("id", str(task_id)).execute()

        return ticket

    # ---- dashboard / active employees ----------------------------------

    def get_active_employees(self) -> list[dict]:
        tasks_resp = self.client.table("tasks").select("*").eq("status", "in_progress").execute()
        in_progress_tasks = tasks_resp.data or []
        if not in_progress_tasks:
            return []

        employee_ids = list({task["employee_id"] for task in in_progress_tasks})
        employees_resp = self.client.table("employees").select("*").in_("id", employee_ids).execute()
        employees_by_id = {employee["id"]: employee for employee in (employees_resp.data or [])}

        result = []
        for task in in_progress_tasks:
            employee = employees_by_id.get(task["employee_id"])
            if not employee:
                continue
            tracked_ms, score = self.get_task_productivity(task)
            result.append(
                {
                    "employee_id": task["employee_id"],
                    "employee_name": employee["full_name"],
                    "task_id": task["id"],
                    "task_title": task["title"],
                    "tracked_minutes": round(tracked_ms / 60_000, 2),
                    "score": score,
                }
            )
        return result

    def get_dashboard_summary(self) -> dict:
        active_employees = self.get_active_employees()
        active_employee_count = len(active_employees)
        avg_productivity = (
            round(sum(e["score"] for e in active_employees) / active_employee_count, 2)
            if active_employee_count
            else 0.0
        )

        today_start = datetime.now(timezone.utc).date().isoformat() + "T00:00:00Z"
        tickets_resp = (
            self.client.table("tickets")
            .select("id", count="exact")
            .gte("created_at", today_start)
            .execute()
        )
        tickets_generated_today = tickets_resp.count or 0

        return {
            "avg_productivity": avg_productivity,
            "active_employee_count": active_employee_count,
            "tickets_generated_today": tickets_generated_today,
        }

    # ---- ticket history --------------------------------------------------

    @staticmethod
    def _normalize_ticket_row(row: dict) -> dict:
        """Old (own-capture-agent) ticket rows don't have tracked_ms/source -
        fall back to active_ms + idle_ms and 'legacy' so they still render
        in the same API shape as Jibble-sourced tickets."""
        tracked_ms = row.get("tracked_ms")
        if tracked_ms is None:
            tracked_ms = (row.get("active_ms") or 0) + (row.get("idle_ms") or 0)
        return {**row, "tracked_ms": tracked_ms, "source": row.get("source") or "legacy"}

    def list_tickets(
        self,
        employee_id: UUID | None,
        task_id: UUID | None,
        page: int,
        page_size: int,
    ) -> tuple[list[dict], int]:
        query = self.client.table("tickets").select("*", count="exact")
        if employee_id is not None:
            query = query.eq("employee_id", str(employee_id))
        if task_id is not None:
            query = query.eq("task_id", str(task_id))

        start = (page - 1) * page_size
        end = start + page_size - 1
        resp = query.order("created_at", desc=True).range(start, end).execute()

        items = [self._normalize_ticket_row(row) for row in (resp.data or [])]
        return items, resp.count or 0

    # ---- Jibble sync ----------------------------------------------------

    def get_sync_state(self, key: str) -> datetime | None:
        resp = self.client.table("sync_state").select("last_synced_at").eq("key", key).execute()
        rows = resp.data or []
        if not rows:
            return None
        return _parse_iso(rows[0]["last_synced_at"])

    def set_sync_state(self, key: str, when: datetime) -> None:
        self.client.table("sync_state").upsert(
            {"key": key, "last_synced_at": when.isoformat()}, on_conflict="key"
        ).execute()

    def upsert_synced_time_entry(self, entry: dict) -> dict:
        """Map one raw Jibble time-entry payload to our schema and upsert it.

        Idempotent: keyed on jibble_entry_id (unique constraint), so
        re-running the sync with overlapping entries just re-writes the same
        row instead of duplicating it. Raises ValueError on a record this
        can't process (missing required fields, or a Jibble member with no
        matching employee) - the sync job catches that per-record, logs it,
        and continues the batch rather than failing the whole run.
        """
        jibble_entry_id = _pick(entry, "id", "entryId")
        jibble_member_id = _pick(entry, "memberId", "member_id")
        jibble_activity_id = _pick(entry, "activityId", "activity_id")
        activity_name = _pick(entry, "activityName", "activity_name")
        entry_start = _pick(entry, "startTime", "start")
        entry_end = _pick(entry, "endTime", "end")
        duration_seconds = _pick(entry, "duration", "durationSeconds")

        if not jibble_entry_id or not jibble_member_id or not entry_start:
            raise ValueError(f"Jibble time entry missing required fields: {entry!r}")

        employee = self.get_employee_by_jibble_member_id(str(jibble_member_id))
        if not employee:
            raise ValueError(f"No employee mapped to Jibble member {jibble_member_id!r}")
        employee_id = employee["id"]

        task_id = None
        task_created = False
        if jibble_activity_id:
            task = self.find_task_by_jibble_activity(employee_id, str(jibble_activity_id))
            if task is None:
                task = self.create_task(
                    UUID(employee_id),
                    activity_name or "Jibble Activity",
                    estimated_minutes=None,
                    jibble_activity_id=str(jibble_activity_id),
                )
                task_created = True
            task_id = task["id"]

        duration_ms = int(float(duration_seconds) * 1000) if duration_seconds is not None else None

        row = {
            "jibble_entry_id": str(jibble_entry_id),
            "task_id": task_id,
            "employee_id": employee_id,
            "activity_name": activity_name,
            "entry_start": entry_start,
            "entry_end": entry_end,
            "duration_ms": duration_ms,
        }
        self.client.table("synced_time_entries").upsert(row, on_conflict="jibble_entry_id").execute()

        return {"inserted": True, "task_created": task_created}

    # ---- idle/active input & app-focus tracking -------------------------

    def upsert_idle_time_log(self, payload: IdleTimeLogIn) -> dict:
        """Upsert the employee's cumulative daily snapshot. The client sends
        running totals for the whole day (not a delta), so this replaces the
        row for (employee_id, date) rather than incrementing it - safe to
        retry and immune to double-counting from client restarts."""
        row = {
            "employee_id": str(payload.employee_id),
            "date": payload.date.isoformat(),
            "active_seconds": payload.active_seconds,
            "idle_seconds": payload.idle_seconds,
            "app_focus_seconds": payload.app_focus_seconds,
            "total_logged_seconds": payload.active_seconds + payload.idle_seconds,
            "last_active_app": payload.last_active_app,
            "last_is_idle": payload.last_is_idle,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        resp = self.client.table("idle_time_logs").upsert(
            row, on_conflict="employee_id,date"
        ).execute()
        return resp.data[0]

    def get_idle_time_range(self, employee_id: UUID, start_date: date, end_date: date) -> list[dict]:
        resp = (
            self.client.table("idle_time_logs")
            .select("*")
            .eq("employee_id", str(employee_id))
            .gte("date", start_date.isoformat())
            .lte("date", end_date.isoformat())
            .order("date", desc=True)
            .execute()
        )
        return resp.data or []

    @staticmethod
    def _idle_status(row: dict, now: datetime, is_checked_in: bool = False) -> str:
        updated_at = _parse_iso(row["updated_at"])
        stale_seconds = (now - updated_at).total_seconds()
        # A confirmed shift_events check-in is a much stronger "this person
        # is on the clock" signal than a fresh idle_time_logs sync - a
        # single missed 90s flush (a brief network blip, a productivity_service
        # restart, anything transient) shouldn't make a genuinely checked-in
        # employee flash "Away" the instant it happens. Without a check-in
        # on record at all, staleness is the only liveness signal available,
        # so keep the original tighter threshold in that case.
        away_threshold = IDLE_STATUS_AWAY_THRESHOLD_SECONDS * 2.5 if is_checked_in else IDLE_STATUS_AWAY_THRESHOLD_SECONDS
        if stale_seconds > away_threshold:
            return "AWAY"
        if is_checked_in and stale_seconds > IDLE_STATUS_AWAY_THRESHOLD_SECONDS:
            # Between the two thresholds: syncs have stopped but they're
            # still on the clock - report IDLE rather than the harsher AWAY.
            return "IDLE"
        if row.get("last_is_idle"):
            return "IDLE"
        if row.get("last_active_app") == "Cisco Jabber":
            return "ACTIVE_JABBER"
        if row.get("last_active_app") == "Wildix":
            return "ACTIVE_WILDIX"
        return "ACTIVE"

    def _camera_aware_status(
        self, employee_id: UUID, idle_row: dict, now: datetime, is_checked_in: bool
    ) -> str:
        """For camera-monitored employees: reuses presence_logs.combined_status
        AS-IS - the exact same value already computed once by the client
        (presenceDetector.ts's runCheck) and already used everywhere else
        presence data is summarized (get_presence_summary's
        combinedActiveSeconds/idleAwaySeconds). There is deliberately no
        second, independent "camera beats input" priority rule here - an
        earlier version of this method re-derived its own definition
        (face detected required for ACTIVE, input alone only got IDLE),
        which collided with combined_status's own OR-based definition
        (active if face OR input) the moment face detection failed to
        recognize a face - which, in practice, it always did, silently
        downgrading every genuinely-active, camera-monitored employee to
        IDLE. Reusing combined_status outright makes that collision
        structurally impossible: one status definition, used everywhere,
        camera and input both able to confirm ACTIVE independently rather
        than camera being able to override a working input signal.
        Employees who've never enabled/consented to camera monitoring (no
        presence_logs rows at all) or whose latest check has gone stale
        fall back to the existing input-only _idle_status() unchanged."""
        latest_presence = self.get_latest_presence_log(employee_id, before=now)
        if latest_presence is not None:
            presence_age = (now - _parse_iso(latest_presence["occurred_at"])).total_seconds()
            if presence_age <= CAMERA_STATUS_FRESHNESS_SECONDS:
                combined = latest_presence.get("combined_status")
                if combined == "active":
                    return "ACTIVE"
                if combined == "idle":
                    return "IDLE"
                if combined == "away":
                    return "AWAY"
        return self._idle_status(idle_row, now, is_checked_in=is_checked_in)

    def get_idle_time_summary(self, day: date) -> list[dict]:
        """Today's per-employee idle/active/break/shift status for the
        Manager Supervisor Portal overview card and the "Today, per
        employee" table. Delegates to get_shift_summary() - the SAME
        calculation used by the single-employee shift endpoint and the
        Presence Verification card - so this list can never drift from
        those. Polled (not push-real-time)."""
        idle_rows = (
            self.client.table("idle_time_logs").select("employee_id").eq("date", day.isoformat()).execute()
        ).data or []
        has_idle_data = {row["employee_id"] for row in idle_rows}

        result = []
        for employee in self.list_employees():
            if employee.get("role", "EMPLOYEE") != "EMPLOYEE":
                # Admin/manager accounts that logged into the desktop app
                # themselves (e.g. to test it) get auto-registered the same
                # as any real employee - this table is employee-tracking
                # only, so exclude anyone whose role says otherwise.
                continue
            employee_id = employee["id"]
            summary = self.get_shift_summary(UUID(employee_id), day)
            if summary["status"] == "NOT_CHECKED_IN" and employee_id not in has_idle_data:
                # Never touched the app today at all - omit rather than
                # list every employee in the org on this table.
                continue
            result.append(
                {
                    "employee_id": employee_id,
                    "employee_name": employee["full_name"],
                    "date": day.isoformat(),
                    "active_seconds": summary["active_seconds"],
                    "idle_seconds": summary["idle_seconds"],
                    "jabber_seconds": summary["jabber_seconds"],
                    "wildix_seconds": summary["wildix_seconds"],
                    "productivity_percentage": summary["productivity_percentage"],
                    "status": summary["status"],
                    "updated_at": summary["idle_updated_at"] or datetime.now(timezone.utc).isoformat(),
                    "is_on_break": summary["is_on_break"],
                    "break_seconds": summary["break_seconds"],
                    "shift_duration_seconds": summary["shift_duration_seconds"],
                    "is_checked_in": summary["is_checked_in"],
                }
            )
        return result

    # ---- camera presence: consent -----------------------------------------

    def get_latest_camera_consent(self, employee_id: UUID) -> dict | None:
        resp = (
            self.client.table("camera_consent_log")
            .select("*")
            .eq("employee_id", str(employee_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def record_camera_consent(self, employee_id: UUID, consented: bool) -> dict:
        resp = (
            self.client.table("camera_consent_log")
            .insert({"employee_id": str(employee_id), "consented": consented})
            .execute()
        )
        return resp.data[0]

    def has_active_camera_consent(self, employee_id: UUID) -> bool:
        latest = self.get_latest_camera_consent(employee_id)
        return bool(latest and latest.get("consented"))

    # ---- camera presence: enablement config --------------------------------

    def get_globally_enabled(self) -> bool:
        resp = self.client.table("presence_config").select("*").eq("id", 1).execute()
        rows = resp.data or []
        return bool(rows[0]["globally_enabled"]) if rows else False

    def set_globally_enabled(self, enabled: bool) -> None:
        self.client.table("presence_config").update({"globally_enabled": enabled}).eq("id", 1).execute()

    def get_camera_config(self, employee_id: UUID) -> dict:
        employee = self.get_employee(employee_id)
        employee_enabled = bool(employee.get("camera_monitoring_enabled")) if employee else False
        globally_enabled = self.get_globally_enabled()
        return {
            "employee_id": str(employee_id),
            "globally_enabled": globally_enabled,
            "employee_enabled": employee_enabled,
            "effective_enabled": globally_enabled and employee_enabled,
        }

    def set_employee_camera_enabled(self, employee_id: UUID, enabled: bool) -> dict:
        resp = (
            self.client.table("employees")
            .update({"camera_monitoring_enabled": enabled})
            .eq("id", str(employee_id))
            .execute()
        )
        return resp.data[0]

    # ---- camera presence: raw logs & summary -------------------------------

    def get_latest_presence_log(self, employee_id: UUID, before: datetime | None = None) -> dict | None:
        query = self.client.table("presence_logs").select("*").eq("employee_id", str(employee_id))
        if before is not None:
            query = query.lte("occurred_at", before.isoformat())
        # Ascending + take last, not desc+limit(1) - see get_latest_shift_event
        # for why: a stable sort resolves same-timestamp ties to whichever
        # row was actually inserted more recently, which desc+limit(1) gets
        # backwards.
        rows = query.order("occurred_at").execute().data or []
        return rows[-1] if rows else None

    def insert_presence_log(self, payload: PresenceLogIn) -> dict:
        """Raises ValueError if this employee hasn't actively consented -
        defense in depth against a modified client bypassing the UI gate,
        on top of the fact that these rows never carry image data in the
        first place (there's no field for it in the schema at all)."""
        if not self.has_active_camera_consent(payload.employee_id):
            raise ValueError(f"Employee {payload.employee_id} has no active camera-monitoring consent")

        row = {
            "employee_id": str(payload.employee_id),
            "occurred_at": payload.timestamp.isoformat(),
            "face_detected": payload.face_detected,
            "mouse_keyboard_active": payload.mouse_keyboard_active,
            "combined_status": payload.combined_status,
        }
        resp = self.client.table("presence_logs").insert(row).execute()
        return resp.data[0]

    @staticmethod
    def _compute_presence_summary(rows: list[dict], employee_id: UUID, day: date) -> dict:
        """Pure computation half of get_presence_summary() - takes an
        already-fetched, already-day-filtered list of presence_logs rows
        instead of querying, so get_report_rows() can fetch a whole date
        range's rows ONCE per employee and slice them per day in memory
        rather than re-querying per day (see get_report_rows() for why that
        mattered: an 8-day range was taking ~14s from this exact N+1
        pattern - 3 Supabase round-trips per employee per day)."""
        # Real elapsed-time accounting rather than a flat row_count * interval
        # estimate: attribute the time between two consecutive checks to
        # whatever status the earlier one reported, capped at 2x the normal
        # poll cadence. A stalled/skipped check (camera hung, laptop asleep,
        # app closed) can leave a gap of many minutes between rows - without
        # the cap that dead time would get silently counted as active or
        # idle time nobody actually observed, which is what made this number
        # drift far from the input-tracker's own (independently, continuously
        # ticking) totals for the same session.
        interval = PRESENCE_POLL_INTERVAL_SECONDS
        max_gap_seconds = interval * 2

        camera_active = 0.0
        input_active = 0.0
        combined_active = 0.0
        idle_away = 0.0
        for i, row in enumerate(rows):
            if i + 1 < len(rows):
                gap = (_parse_iso(rows[i + 1]["occurred_at"]) - _parse_iso(row["occurred_at"])).total_seconds()
            else:
                gap = interval
            seconds = min(max(gap, 0), max_gap_seconds)

            if row.get("face_detected"):
                camera_active += seconds
            if row.get("mouse_keyboard_active"):
                input_active += seconds
            if row.get("combined_status") == "active":
                combined_active += seconds
            elif row.get("combined_status") in ("idle", "away"):
                idle_away += seconds

        return {
            "employee_id": str(employee_id),
            "date": day.isoformat(),
            "sample_count": len(rows),
            "camera_active_seconds": round(camera_active),
            "input_active_seconds": round(input_active),
            "combined_active_seconds": round(combined_active),
            "idle_away_seconds": round(idle_away),
        }

    def get_presence_summary(self, employee_id: UUID, day: date) -> dict:
        # Karachi-local day boundaries, not UTC: `day` is normally "today"
        # per KARACHI_TZ (see the shift/idle-time routers' defaults), and
        # presence_logs.occurred_at is a real timestamptz - Postgres
        # compares it correctly against a +05:00-offset literal, no
        # conversion needed on this end. Using UTC boundaries here while
        # the rest of the app agrees on Karachi-day is exactly what caused
        # a several-hour window around each local midnight where this
        # returned zero rows despite presence checks actively landing.
        day_start = datetime.combine(day, time.min, tzinfo=KARACHI_TZ).isoformat()
        day_end = datetime.combine(day, time.max, tzinfo=KARACHI_TZ).isoformat()
        resp = (
            self.client.table("presence_logs")
            .select("*")
            .eq("employee_id", str(employee_id))
            .gte("occurred_at", day_start)
            .lte("occurred_at", day_end)
            .order("occurred_at")
            .execute()
        )
        return self._compute_presence_summary(resp.data or [], employee_id, day)

    # ---- shift/break event log & unified summary ---------------------------
    #
    # shift_events is the authoritative, append-only event log for
    # check-in/check-out/break boundaries. get_shift_summary() below is the
    # ONE place that turns that log (plus idle_time_logs and presence_logs,
    # both untouched by this section) into every number a dashboard shows
    # for an employee/day - active/idle/break/shift-duration/camera/status.
    # Every consumer (get_idle_time_summary above, the /api/shift/summary
    # route, the scheduled-break job) calls this same function rather than
    # recomputing any of it independently.

    def get_latest_shift_event(self, employee_id: UUID, before: datetime | None = None) -> dict | None:
        # Ascending order + take the last element, not desc+limit(1): a
        # stable sort preserves original (insertion) order among ties, so
        # ascending-then-last always resolves a same-timestamp tie to
        # whichever row was actually inserted more recently, while
        # desc+limit(1) would incorrectly return the OLDER of two tied rows.
        # Row counts here are small (per-employee shift events over a day
        # or two), so fetching the full match set client-side is cheap.
        query = self.client.table("shift_events").select("*").eq("employee_id", str(employee_id))
        if before is not None:
            query = query.lte("occurred_at", before.isoformat())
        resp = query.order("occurred_at").execute()
        rows = resp.data or []
        return rows[-1] if rows else None

    def _insert_shift_event(
        self,
        employee_id: UUID,
        event_type: str,
        break_type: str | None = None,
        triggered_by: str = "manual",
        label: str | None = None,
        schedule_key: str | None = None,
        occurred_at: datetime | None = None,
        baseline_active_seconds: int | None = None,
        baseline_idle_seconds: int | None = None,
    ) -> dict:
        row = {
            "employee_id": str(employee_id),
            "event_type": event_type,
            "occurred_at": (occurred_at or datetime.now(timezone.utc)).isoformat(),
            "break_type": break_type,
            "triggered_by": triggered_by,
            "label": label,
            "schedule_key": schedule_key,
            "baseline_active_seconds": baseline_active_seconds,
            "baseline_idle_seconds": baseline_idle_seconds,
        }

        def _write(payload: dict):
            if schedule_key:
                # Scheduled events carry a deterministic key so a cron
                # misfire re-run or process restart mid-tick upserts onto
                # the same row instead of inserting a duplicate.
                return self.client.table("shift_events").upsert(
                    payload, on_conflict="employee_id,schedule_key"
                ).execute()
            return self.client.table("shift_events").insert(payload).execute()

        try:
            resp = _write(row)
        except Exception as exc:
            # Falls back to writing without the baseline_* columns if
            # migration 006_shift_events_baseline.sql hasn't been applied
            # yet - check-in/out/break logging is a critical path that
            # shouldn't go down because of an optional, additive column
            # this session's own live numbers depend on but nothing else
            # does. Once the migration lands, this branch stops firing.
            if "baseline_active_seconds" not in str(exc) and "baseline_idle_seconds" not in str(exc):
                raise
            logger.warning(
                "shift_events insert failed on baseline_* columns (migration "
                "006_shift_events_baseline.sql not applied yet?) - retrying "
                "without them: %s", exc,
            )
            row.pop("baseline_active_seconds", None)
            row.pop("baseline_idle_seconds", None)
            resp = _write(row)
        return resp.data[0]

    def log_check_in(self, employee_id: UUID, occurred_at: datetime | None = None) -> dict:
        # Snapshot today's cumulative idle_time_logs totals as this
        # session's baseline, so get_shift_summary() can show "since this
        # check-in" live numbers (resetting at each new check-in) without
        # changing how idle_time_logs itself accumulates - reports still
        # read that table's real whole-day cumulative total directly.
        today = datetime.now(KARACHI_TZ).date().isoformat()
        idle_rows = (
            self.client.table("idle_time_logs")
            .select("active_seconds,idle_seconds")
            .eq("employee_id", str(employee_id))
            .eq("date", today)
            .execute()
        ).data or []
        baseline_active = idle_rows[0].get("active_seconds", 0) if idle_rows else 0
        baseline_idle = idle_rows[0].get("idle_seconds", 0) if idle_rows else 0
        return self._insert_shift_event(
            employee_id, "check_in", occurred_at=occurred_at,
            baseline_active_seconds=baseline_active, baseline_idle_seconds=baseline_idle,
        )

    def log_check_out(self, employee_id: UUID, occurred_at: datetime | None = None) -> dict:
        return self._insert_shift_event(employee_id, "check_out", occurred_at=occurred_at)

    def start_break(
        self,
        employee_id: UUID,
        break_type: str,
        triggered_by: str = "manual",
        label: str | None = None,
        schedule_key: str | None = None,
        occurred_at: datetime | None = None,
    ) -> dict:
        return self._insert_shift_event(
            employee_id, "break_start", break_type=break_type,
            triggered_by=triggered_by, label=label, schedule_key=schedule_key,
            occurred_at=occurred_at,
        )

    def end_break(
        self,
        employee_id: UUID,
        break_type: str,
        triggered_by: str = "manual",
        schedule_key: str | None = None,
        occurred_at: datetime | None = None,
    ) -> dict:
        return self._insert_shift_event(
            employee_id, "break_end", break_type=break_type,
            triggered_by=triggered_by, schedule_key=schedule_key,
            occurred_at=occurred_at,
        )

    def get_employees_eligible_for_scheduled_break(self, now: datetime) -> list[dict]:
        """Currently working: checked in and not already on a break."""
        eligible = []
        for employee in self.list_employees():
            latest = self.get_latest_shift_event(UUID(employee["id"]), before=now)
            if latest and latest["event_type"] in ("check_in", "break_end"):
                eligible.append(employee)
        return eligible

    def _reconstruct_session(self, employee_id: UUID, now: datetime) -> dict:
        """Rebuilds the employee's CURRENT (or most recently completed)
        shift session from shift_events: the session always starts at the
        most recent check_in seen (within a 24h lookback, so a shift
        crossing local midnight still resolves correctly), and is
        "complete" if a check_out happened after that check_in."""
        lookback_start = now - timedelta(hours=24)
        try:
            resp = (
                self.client.table("shift_events")
                .select("*")
                .eq("employee_id", str(employee_id))
                .gte("occurred_at", lookback_start.isoformat())
                .lte("occurred_at", now.isoformat())
                .order("occurred_at")
                .execute()
            )
            events = resp.data or []
        except Exception:
            # Degrades to "no shift events" (NOT_CHECKED_IN) rather than
            # taking down every idle-time/presence endpoint with it - most
            # likely cause is migration 005_shift_events.sql not having
            # been applied to this Supabase project yet, which shouldn't
            # break the idle_time_logs/presence_logs functionality that
            # worked before this feature existed.
            logger.exception(
                "Failed to query shift_events for employee %s - is migration "
                "005_shift_events.sql applied? Treating as no shift events.",
                employee_id,
            )
            events = []

        last_check_in = None
        for event in events:
            if event["event_type"] == "check_in":
                last_check_in = event
        if last_check_in is None:
            return {
                "session_start": None,
                "session_start_event": None,
                "check_out_at": None,
                "is_on_break": False,
                "total_break_seconds": 0.0,
                "last_event": events[-1] if events else None,
            }

        session_start = _parse_iso(last_check_in["occurred_at"])
        relevant = [e for e in events if _parse_iso(e["occurred_at"]) >= session_start]

        check_out_at: datetime | None = None
        open_break_start: dict | None = None
        completed_break_seconds = 0.0
        for event in relevant:
            if event["event_type"] == "break_start":
                open_break_start = event
            elif event["event_type"] == "break_end" and open_break_start is not None:
                completed_break_seconds += (
                    _parse_iso(event["occurred_at"]) - _parse_iso(open_break_start["occurred_at"])
                ).total_seconds()
                open_break_start = None
            elif event["event_type"] == "check_out":
                check_out_at = _parse_iso(event["occurred_at"])

        is_on_break = open_break_start is not None
        total_break_seconds = completed_break_seconds
        if is_on_break:
            total_break_seconds += (now - _parse_iso(open_break_start["occurred_at"])).total_seconds()

        return {
            "session_start": session_start,
            "session_start_event": last_check_in,
            "check_out_at": check_out_at,
            "is_on_break": is_on_break,
            "total_break_seconds": total_break_seconds,
            "last_event": relevant[-1] if relevant else None,
        }

    def get_shift_summary(self, employee_id: UUID, day: date) -> dict:
        """THE single authoritative calculation for an employee/day: shift
        duration (break-adjusted), active/idle seconds, break seconds,
        camera-confirmed time, and current status. Every dashboard
        component and endpoint that shows any of these numbers reads this
        (directly, or via get_idle_time_summary's per-employee loop) -
        nothing else recomputes them independently."""
        now = datetime.now(timezone.utc)
        session = self._reconstruct_session(employee_id, now)

        session_start = session["session_start"]
        session_start_event = session["session_start_event"]
        check_out_at = session["check_out_at"]
        is_on_break = session["is_on_break"]
        total_break_seconds = session["total_break_seconds"]
        last_event = session["last_event"]
        is_checked_in = session_start is not None and check_out_at is None

        if session_start is None:
            shift_duration_seconds = 0.0
        else:
            end_point = check_out_at or now
            shift_duration_seconds = max(
                0.0, (end_point - session_start).total_seconds() - total_break_seconds
            )

        idle_rows = (
            self.client.table("idle_time_logs")
            .select("*")
            .eq("employee_id", str(employee_id))
            .eq("date", day.isoformat())
            .execute()
        ).data or []
        idle_row = idle_rows[0] if idle_rows else None
        raw_active_seconds = (idle_row.get("active_seconds") or 0) if idle_row else 0
        raw_idle_seconds = (idle_row.get("idle_seconds") or 0) if idle_row else 0
        app_focus = (idle_row.get("app_focus_seconds") or {}) if idle_row else {}

        # "Since this check-in," not the whole day's cumulative total -
        # resets to zero if the employee checked out and back in, per the
        # requirement that live counters not carry a prior session's totals
        # forward. idle_time_logs itself is untouched (get_daily_report_row
        # reads its real whole-day cumulative value for reports).
        baseline_active = (session_start_event.get("baseline_active_seconds") or 0) if session_start_event else 0
        baseline_idle = (session_start_event.get("baseline_idle_seconds") or 0) if session_start_event else 0
        active_seconds = max(0, raw_active_seconds - baseline_active)
        idle_seconds = max(0, raw_idle_seconds - baseline_idle)
        total_logged = active_seconds + idle_seconds
        productivity_percentage = (
            round((active_seconds / total_logged) * 100, 2) if total_logged > 0 else 0.0
        )

        presence = self.get_presence_summary(employee_id, day)

        if session_start is None:
            status = "NOT_CHECKED_IN"
        elif check_out_at is not None:
            status = "CHECKED_OUT"
        elif is_on_break:
            status = "ON_BREAK"
        elif (
            last_event is not None
            and last_event["event_type"] == "break_end"
            and (now - _parse_iso(last_event["occurred_at"])).total_seconds() < GRACE_PERIOD_SECONDS
        ):
            # Grace period: pin the displayed status to ACTIVE without
            # touching idle_seconds/active_seconds, which keep coming
            # straight from idle_time_logs regardless.
            status = "ACTIVE"
        elif idle_row is not None:
            status = self._camera_aware_status(employee_id, idle_row, now, is_checked_in)
        else:
            status = "ACTIVE"

        return {
            "employee_id": str(employee_id),
            "date": day.isoformat(),
            "is_checked_in": is_checked_in,
            "is_on_break": is_on_break,
            "shift_duration_seconds": round(shift_duration_seconds),
            "break_seconds": round(total_break_seconds),
            "active_seconds": active_seconds,
            "idle_seconds": idle_seconds,
            "jabber_seconds": app_focus.get("Cisco Jabber", 0),
            "wildix_seconds": app_focus.get("Wildix", 0),
            "productivity_percentage": productivity_percentage,
            "status": status,
            "idle_updated_at": idle_row.get("updated_at") if idle_row else None,
            "camera_active_seconds": presence["camera_active_seconds"],
            "input_active_seconds": presence["input_active_seconds"],
            "combined_active_seconds": presence["combined_active_seconds"],
            "idle_away_seconds": presence["idle_away_seconds"],
            "sample_count": presence["sample_count"],
        }

    # ---- historical reports --------------------------------------------
    #
    # get_shift_summary() above is deliberately single-session/live/grace-
    # period-aware - the right job for "what's this employee doing right
    # now," the wrong one for a report. get_daily_report_row() is the
    # separate, day-scoped calculation reports need: it merges ALL of a
    # calendar day's check-in/check-out/break sessions into one row (an
    # employee who popped out and back in still gets a single day's totals,
    # not two rows), and works correctly for ANY past date, unlike
    # _reconstruct_session's "current session near now" lookback.

    @staticmethod
    def _karachi_date_range(start_date: date, end_date: date) -> list[date]:
        if end_date < start_date:
            start_date, end_date = end_date, start_date
        days = []
        current = start_date
        while current <= end_date:
            days.append(current)
            current += timedelta(days=1)
        return days

    @staticmethod
    def _compute_daily_report_row(
        events: list[dict], idle_row: dict | None, presence: dict, employee_id: UUID, day: date
    ) -> dict:
        """Pure computation half of get_daily_report_row() - takes
        already-fetched, already-day-filtered shift_events/idle_time_logs/
        presence data instead of querying. Exists for the same reason as
        _compute_presence_summary(): get_report_rows() fetches a whole date
        range's data ONCE per employee and slices it per day in memory,
        instead of the 3-queries-per-employee-per-day pattern this method
        used to run inline (an 8-day, 4-employee report was taking ~14s -
        720 sequential Supabase round-trips for a 6-month range)."""
        check_ins = [e for e in events if e["event_type"] == "check_in"]
        check_outs = [e for e in events if e["event_type"] == "check_out"]
        first_check_in = _parse_iso(check_ins[0]["occurred_at"]) if check_ins else None
        # The day is "closed" only if its very last event is a check_out -
        # a trailing check_in with no matching check_out means the
        # employee is still on the clock (or forgot to check out), so
        # there's no correct check-out time or total-hours figure to report
        # for that day yet.
        last_check_out = (
            _parse_iso(check_outs[-1]["occurred_at"])
            if check_outs and events and events[-1]["event_type"] == "check_out"
            else None
        )

        # Sum each individual check-in/check-out session's own span, NOT
        # the outer span from first check-in to last check-out - the gap
        # BETWEEN two sessions (checked out entirely, e.g. stepped out for
        # an hour and came back) must not be counted as worked time, only
        # the time actually spent on the clock within each session.
        total_worked_seconds = 0.0
        total_break_seconds = 0.0
        open_check_in: datetime | None = None
        open_break_start: dict | None = None
        for event in events:
            if event["event_type"] == "check_in":
                open_check_in = _parse_iso(event["occurred_at"])
            elif event["event_type"] == "check_out" and open_check_in is not None:
                total_worked_seconds += (_parse_iso(event["occurred_at"]) - open_check_in).total_seconds()
                open_check_in = None
            elif event["event_type"] == "break_start":
                open_break_start = event
            elif event["event_type"] == "break_end" and open_break_start is not None:
                total_break_seconds += (
                    _parse_iso(event["occurred_at"]) - _parse_iso(open_break_start["occurred_at"])
                ).total_seconds()
                open_break_start = None
            # An unmatched trailing check_in or break_start on a historical
            # day is a data anomaly (app crashed mid-session, forgot to
            # check out, etc.) - deliberately not counted rather than
            # guessing an end time.

        total_shift_seconds = max(0.0, total_worked_seconds - total_break_seconds)

        active_seconds = (idle_row.get("active_seconds") or 0) if idle_row else 0
        idle_seconds = (idle_row.get("idle_seconds") or 0) if idle_row else 0
        app_focus = (idle_row.get("app_focus_seconds") or {}) if idle_row else {}
        total_logged = (idle_row.get("total_logged_seconds") or 0) if idle_row else 0
        productivity_percentage = (
            round((active_seconds / total_logged) * 100, 2) if total_logged > 0 else 0.0
        )

        return {
            "employee_id": str(employee_id),
            "date": day.isoformat(),
            "attendance_status": "PRESENT" if first_check_in is not None else "ABSENT",
            "check_in_at": first_check_in.isoformat() if first_check_in else None,
            "check_out_at": last_check_out.isoformat() if last_check_out else None,
            "still_checked_in": bool(check_ins) and last_check_out is None,
            "shift_duration_seconds": round(total_shift_seconds),
            "break_seconds": round(total_break_seconds),
            "active_seconds": active_seconds,
            "idle_seconds": idle_seconds,
            "jabber_seconds": app_focus.get("Cisco Jabber", 0),
            "wildix_seconds": app_focus.get("Wildix", 0),
            "productivity_percentage": productivity_percentage,
            "camera_active_seconds": presence["camera_active_seconds"],
            "combined_active_seconds": presence["combined_active_seconds"],
        }

    def get_daily_report_row(self, employee_id: UUID, day: date) -> dict:
        day_start = datetime.combine(day, time.min, tzinfo=KARACHI_TZ)
        day_end = datetime.combine(day, time.max, tzinfo=KARACHI_TZ)
        try:
            events = (
                self.client.table("shift_events")
                .select("*")
                .eq("employee_id", str(employee_id))
                .gte("occurred_at", day_start.isoformat())
                .lte("occurred_at", day_end.isoformat())
                .order("occurred_at")
                .execute()
            ).data or []
        except Exception:
            logger.exception(
                "Failed to query shift_events for report row (employee %s, day %s) - "
                "is migration 005_shift_events.sql applied? Treating as no events.",
                employee_id, day,
            )
            events = []

        idle_rows = (
            self.client.table("idle_time_logs")
            .select("*")
            .eq("employee_id", str(employee_id))
            .eq("date", day.isoformat())
            .execute()
        ).data or []
        idle_row = idle_rows[0] if idle_rows else None

        presence = self.get_presence_summary(employee_id, day)

        return self._compute_daily_report_row(events, idle_row, presence, employee_id, day)

    def get_report_rows(self, start_date: date, end_date: date, employee_id: UUID | None = None) -> list[dict]:
        """Flat list of one row per employee per day in [start_date,
        end_date] - what the Attendance/Productivity report endpoints hand
        to the frontend for PDF generation and dashboard charts. Fetches
        shift_events/idle_time_logs/presence_logs ONCE per employee for the
        WHOLE range (not once per day - see _compute_daily_report_row()'s
        docstring for why that mattered) and slices each day's data out in
        memory via _compute_daily_report_row()/_compute_presence_summary()."""
        employees = (
            [self.get_employee(employee_id)] if employee_id else self.list_employees()
        )
        employees = [e for e in employees if e]
        if employee_id is None:
            # Same admin/manager exclusion as get_idle_time_summary() -
            # doesn't apply when a specific employee_id was explicitly
            # requested, since that's a deliberate choice by the caller.
            employees = [e for e in employees if e.get("role", "EMPLOYEE") == "EMPLOYEE"]
        days = self._karachi_date_range(start_date, end_date)
        range_start = datetime.combine(start_date, time.min, tzinfo=KARACHI_TZ)
        range_end = datetime.combine(end_date, time.max, tzinfo=KARACHI_TZ)

        rows = []
        for employee in employees:
            emp_id = UUID(employee["id"])

            try:
                all_events = (
                    self.client.table("shift_events")
                    .select("*")
                    .eq("employee_id", str(emp_id))
                    .gte("occurred_at", range_start.isoformat())
                    .lte("occurred_at", range_end.isoformat())
                    .order("occurred_at")
                    .execute()
                ).data or []
            except Exception:
                logger.exception(
                    "Failed to query shift_events for report rows (employee %s, %s..%s) - "
                    "is migration 005_shift_events.sql applied? Treating as no events.",
                    emp_id, start_date, end_date,
                )
                all_events = []

            all_idle_rows = (
                self.client.table("idle_time_logs")
                .select("*")
                .eq("employee_id", str(emp_id))
                .gte("date", start_date.isoformat())
                .lte("date", end_date.isoformat())
                .execute()
            ).data or []
            idle_row_by_date = {r["date"]: r for r in all_idle_rows}

            all_presence_rows = (
                self.client.table("presence_logs")
                .select("*")
                .eq("employee_id", str(emp_id))
                .gte("occurred_at", range_start.isoformat())
                .lte("occurred_at", range_end.isoformat())
                .order("occurred_at")
                .execute()
            ).data or []

            events_by_date: dict[str, list[dict]] = {}
            for event in all_events:
                key = _parse_iso(event["occurred_at"]).astimezone(KARACHI_TZ).date().isoformat()
                events_by_date.setdefault(key, []).append(event)

            presence_by_date: dict[str, list[dict]] = {}
            for prow in all_presence_rows:
                key = _parse_iso(prow["occurred_at"]).astimezone(KARACHI_TZ).date().isoformat()
                presence_by_date.setdefault(key, []).append(prow)

            for day in days:
                day_key = day.isoformat()
                day_events = events_by_date.get(day_key, [])
                day_presence_rows = presence_by_date.get(day_key, [])
                presence = self._compute_presence_summary(day_presence_rows, emp_id, day)
                row = self._compute_daily_report_row(
                    day_events, idle_row_by_date.get(day_key), presence, emp_id, day
                )
                row["employee_name"] = employee["full_name"]
                rows.append(row)
        return rows
