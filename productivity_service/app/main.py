import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import activity, dashboard, employees, idle_time, presence, reports, shift, sync, tasks, tickets

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

_scheduler = None


@app.on_event("startup")
def start_scheduler() -> None:
    """Unconditional, unlike the old Jibble-only scheduler this replaces -
    the scheduled-break cron jobs must run regardless of whether Jibble is
    configured."""
    global _scheduler
    from apscheduler.schedulers.background import BackgroundScheduler

    from .jobs.scheduled_breaks import BREAK_WINDOWS, end_scheduled_break, start_scheduled_break

    _scheduler = BackgroundScheduler()

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
    logger.info("Scheduled-break cron jobs registered for: %s", [w["key"] for w in BREAK_WINDOWS])

    _scheduler.start()


@app.on_event("shutdown")
def stop_scheduler() -> None:
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
