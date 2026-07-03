import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_teacher_or_admin
from app.db.session import get_db
from app.models import ShadowingPhrase, User
from app.schemas.shadowing import (
    SHADOW_LEVELS,
    ShadowingPhraseCreate,
    ShadowingPhraseOut,
)

router = APIRouter(prefix="/shadowing", tags=["shadowing"])

# Level ordering for a stable, grouped list (unknown levels sort last).
_LEVEL_ORDER = {lvl: i for i, lvl in enumerate(SHADOW_LEVELS)}


@router.get("/phrases", response_model=list[ShadowingPhraseOut])
def list_phrases(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ShadowingPhrase]:
    """Every active target sentence, ordered by level band then age.
    Visible to all authenticated users (students practise, teachers manage)."""
    rows = db.scalars(
        select(ShadowingPhrase).where(ShadowingPhrase.is_active.is_(True))
    ).all()
    return sorted(
        rows, key=lambda p: (_LEVEL_ORDER.get(p.level, len(_LEVEL_ORDER)), p.created_at)
    )


@router.post("/phrases", response_model=ShadowingPhraseOut, status_code=status.HTTP_201_CREATED)
def create_phrase(
    payload: ShadowingPhraseCreate,
    teacher: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> ShadowingPhrase:
    """Teacher/admin adds a sentence shown to every student."""
    level = payload.level if payload.level in SHADOW_LEVELS else SHADOW_LEVELS[0]
    phrase = ShadowingPhrase(
        created_by=teacher.id,
        text=payload.text.strip(),
        level=level,
        is_active=True,
    )
    db.add(phrase)
    db.commit()
    db.refresh(phrase)
    return phrase


@router.delete("/phrases/{phrase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_phrase(
    phrase_id: uuid.UUID,
    _: User = Depends(require_teacher_or_admin),
    db: Session = Depends(get_db),
) -> None:
    """Teacher/admin removes a sentence (soft delete — hidden from students)."""
    phrase = db.get(ShadowingPhrase, phrase_id)
    if phrase is None or not phrase.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Phrase not found")
    phrase.is_active = False
    db.commit()
