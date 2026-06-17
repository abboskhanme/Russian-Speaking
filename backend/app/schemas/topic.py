import uuid

from pydantic import BaseModel, ConfigDict


class TopicImageOut(BaseModel):
    id: uuid.UUID
    url: str


class TopicCreate(BaseModel):
    name: str


class TopicUpdate(BaseModel):
    name: str


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    images: list[TopicImageOut] = []


class ImageUploadRequest(BaseModel):
    content_type: str


class ImageUploadURL(BaseModel):
    upload_url: str
    image_key: str


class ImageCreate(BaseModel):
    image_key: str
