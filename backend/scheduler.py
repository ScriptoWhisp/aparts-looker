"""
Runs agent_job.run_check() on a repeating interval inside the same process
as the web server - no separate cron, no separate container.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler

import config
from agent_job import run_check

log = logging.getLogger("scheduler")
_scheduler = BackgroundScheduler(timezone="UTC")


def start():
    _scheduler.add_job(
        run_check,
        "interval",
        hours=config.CHECK_INTERVAL_HOURS,
        id="kv_check",
        next_run_time=None,  # don't fire instantly on every container restart
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("Scheduler started, checking every %s hours", config.CHECK_INTERVAL_HOURS)


def run_once_now():
    """Exposed for the manual '/api/check-now' endpoint."""
    run_check()
