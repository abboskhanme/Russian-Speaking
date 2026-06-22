import uuid
from datetime import datetime

from pydantic import BaseModel, Field, ConfigDict

from app.models.enums import SubmissionStatus


class AudioUploadURLRequest(BaseModel):
    question_id: uuid.UUID
    content_type: str = "audio/webm"


class AudioUploadURL(BaseModel):
    upload_url: str
    audio_key: str


class SubmissionCreate(BaseModel):
    question_id: uuid.UUID
    audio_key: str
    audio_duration_sec: float | None = None


class ShadowUploadURLRequest(BaseModel):
    content_type: str = "audio/webm"


class ShadowCreate(BaseModel):
    audio_key: str
    reference_text: str = Field(min_length=1, max_length=500)
    audio_duration_sec: float | None = None


class TranscriptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    text: str
    language: str | None
    word_timestamps: list | None
    pronunciation: dict | None = None


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fluency_score: float
    lexical_score: float
    grammar_score: float
    relevance_score: float | None
    pronunciation_score: float | None
    naturalness_score: float | None = None
    speech_rate_score: float | None = None
    intonation_score: float | None = None
    overall_band: float
    level_score: float | None = None
    native_likeness: float | None = None
    feedback: dict | None
    corrections: list | None
    explanation: dict | None = None


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    question_id: uuid.UUID | None
    reference_text: str | None = None
    audio_key: str
    audio_url: str | None = None
    audio_duration_sec: float | None
    status: SubmissionStatus
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
    # Denormalized labels for review lists (populated in the API layer).
    student_name: str | None = None
    question_title: str | None = None
    question_topic: str | None = None
    question_level: str | None = None
    # Exemplar answer, revealed to the student only on their own result.
    model_answer_text: str | None = None
    # Teacher's manual feedback / band override.
    teacher_comment: str | None = None
    teacher_band: float | None = None
    reviewed_at: datetime | None = None
    transcript: TranscriptOut | None = None
    evaluation: EvaluationOut | None = None


class TeacherFeedback(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)
    band: float | None = Field(default=None, ge=0, le=100)  # 0–100 override
