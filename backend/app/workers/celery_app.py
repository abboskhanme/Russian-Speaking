from celery import Celery
from celery.signals import worker_process_init

from app.core.config import settings
from app.core.logging import configure_logging
from app.core.observability import init_sentry


@worker_process_init.connect
def _init_worker(**_kwargs) -> None:
    configure_logging()
    init_sentry()


celery = Celery(
    "russpeak",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_time_limit=300,
    task_soft_time_limit=270,  # raises SoftTimeLimitExceeded -> submission marked failed
    # Reliability: only ack a task after it finishes (so a worker killed mid-task
    # requeues it instead of losing it), requeue on worker loss, and never prefetch
    # extra tasks — one heavy STT+LLM job per worker at a time keeps latency honest.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        # Recover submissions stuck in "processing" (e.g. worker killed mid-task).
        "fail-stuck-submissions": {
            "task": "fail_stuck_submissions",
            "schedule": 300.0,  # every 5 minutes
        },
        # Reclaim storage from uploads that never became a submission.
        "cleanup-orphan-uploads": {
            "task": "cleanup_orphan_uploads",
            "schedule": 3600.0,  # hourly
        },
        # Purge teacher/admin TEST submissions (view-only, not kept).
        "cleanup-test-submissions": {
            "task": "cleanup_test_submissions",
            "schedule": 3600.0,  # hourly
        },
    },
)
