from fastapi import APIRouter

from app.api.v1 import (
    admin,
    admin_settings,
    auth,
    blocks,
    engagement,
    groups,
    guest,
    notifications,
    questions,
    reports,
    settings_public,
    shadowing,
    submissions,
    topics,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(admin_settings.router)
api_router.include_router(questions.router)
api_router.include_router(blocks.router)
api_router.include_router(topics.router)
api_router.include_router(submissions.router)
api_router.include_router(shadowing.router)
api_router.include_router(users.router)
api_router.include_router(engagement.router)
api_router.include_router(groups.router)
api_router.include_router(reports.router)
api_router.include_router(notifications.router)
api_router.include_router(settings_public.router)
api_router.include_router(guest.router)
