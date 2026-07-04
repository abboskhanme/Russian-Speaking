"""Public (any logged-in user) read access to runtime-managed outbound links,
so the sidebar contact menu can show admin-editable Telegram links without a
frontend rebuild."""

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models import User
from app.schemas.admin_settings import LinksOut
from app.services import app_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/links", response_model=LinksOut)
def public_links(_: User = Depends(get_current_user)) -> LinksOut:
    return LinksOut(**app_settings.resolve_links())
