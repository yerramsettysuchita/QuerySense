import asyncio
from celery import shared_task
from app.core.logging import logger


@shared_task(
    name="app.agent.report_task.run_weekly_report_task",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def run_weekly_report_task(self):
    from app.agent.report import run_weekly_report
    logger.info("Weekly report task started")
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(run_weekly_report())
        logger.info("Weekly report task complete", week=result.get("week_start"))
        return result
    finally:
        loop.close()
