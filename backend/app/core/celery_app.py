from celery import Celery
from celery.schedules import crontab
from app.core.config import settings

celery_app = Celery(
    "querysense",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.services.monitor",
        "app.services.analyzer",
        "app.services.shadow",
        "app.services.mysql_monitor",
        "app.agent.report_task",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "poll-pg-slow-queries": {
            "task": "app.services.monitor.poll_slow_queries",
            "schedule": settings.POLL_INTERVAL_SECONDS,
        },
        "poll-mysql-slow-queries": {
            "task": "app.services.mysql_monitor.poll_mysql_slow_queries_task",
            "schedule": settings.POLL_INTERVAL_SECONDS * 2,
        },
        "weekly-health-report": {
            "task": "app.agent.report_task.run_weekly_report_task",
            "schedule": crontab(hour=9, minute=0, day_of_week=1),
        },
    },
)
