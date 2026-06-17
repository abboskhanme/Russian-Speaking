import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    teacher = "teacher"
    student = "student"


class QuestionType(str, enum.Enum):
    text = "text"
    image = "image"
    video = "video"


class SubmissionStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"
