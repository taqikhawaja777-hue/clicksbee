import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import (
    activity,
    dashboard,
    employees,
    idle_time,
    presence,
    productivity_config,
    reports,
    shift,
    sync,
    tasks,
    tickets,
)

logger = logging.getLogger("app")

app = FastAPI(title="Productivity Tracking Service")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(activity.router)
app.include_router(tasks.router)
app.include_router(employees.router)
app.include_router(dashboard.router)
app.include_router(tickets.router)
app.include_router(sync.router)
app.include_router(idle_time.router)
app.include_router(presence.router)
app.include_router(shift.router)
app.include_router(reports.router)
app.include_router(productivity_config.router)

_scheduler = None


@app.on_event("startup")
def start_scheduler() -> None:
    """Unconditional, unlike the old Jibble-only scheduler this replaces -
    the scheduled-break cron jobs must run regardless of whether Jibble is
    configured."""
    global _scheduler
    from apscheduler.schedulers.background import BackgroundScheduler

    from datetime import datetime, timedelta

    from .jobs.auto_checkout import auto_checkout_at_shift_end
    from .jobs.scheduled_breaks import BREAK_WINDOWS, check_late_returns, end_scheduled_break, start_scheduled_break

    _scheduler = BackgroundScheduler()

    _scheduler.add_job(
        auto_checkout_at_shift_end,
        "cron",
        hour=19,
        minute=0,
        timezone="Asia/Karachi",
        id="auto_checkout_shift_end",
    )

    if settings.jibble_client_id and settings.jibble_client_secret:
        from .jobs.sync_jibble import run_sync

        _scheduler.add_job(
            run_sync,
            "interval",
            minutes=settings.jibble_sync_interval_minutes,
            id="jibble_sync",
        )
        logger.info(
            "Jibble sync scheduler started (every %s minutes).",
            settings.jibble_sync_interval_minutes,
        )
    else:
        logger.info("JIBBLE_CLIENT_ID/SECRET not set - Jibble sync job not scheduled.")

    for window in BREAK_WINDOWS:
        start_hour, start_minute = window["start"].split(":")
        end_hour, end_minute = window["end"].split(":")
        _scheduler.add_job(
            start_scheduled_break,
            "cron",
            hour=int(start_hour),
            minute=int(start_minute),
            timezone="Asia/Karachi",
            args=[window["key"]],
            id=f"break_start_{window['key']}",
        )
        _scheduler.add_job(
            end_scheduled_break,
            "cron",
            hour=int(end_hour),
            minute=int(end_minute),
            timezone="Asia/Karachi",
            args=[window["key"]],
            id=f"break_end_{window['key']}",
        )
        # Fixed 5-minute-after-break-end offset rather than trying to
        # precisely compute end_time + the CONFIGURABLE break_grace_period_seconds
        # at startup (which would drift out of sync the moment an admin
        # changes that setting later) - 5 minutes comfortably clears the
        # default 2-minute grace period and any reasonably short configured
        # one. check_late_returns() itself reads the LIVE config value for
        # what actually counts as "late", so only the cron's firing time is
        # approximate, not the threshold it checks against.
        late_check_time = (
            datetime.combine(datetime.today(), datetime.min.time().replace(hour=int(end_hour), minute=int(end_minute)))
            + timedelta(minutes=5)
        )
        _scheduler.add_job(
            check_late_returns,
            "cron",
            hour=late_check_time.hour,
            minute=late_check_time.minute,
            timezone="Asia/Karachi",
            args=[window["key"]],
            id=f"break_late_check_{window['key']}",
        )
    logger.info("Scheduled-break cron jobs registered for: %s", [w["key"] for w in BREAK_WINDOWS])

    _scheduler.start()


@app.on_event("shutdown")
def stop_scheduler() -> None:
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
