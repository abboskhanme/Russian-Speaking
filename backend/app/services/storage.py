"""S3-compatible object storage (MinIO in dev, R2/S3 in prod).

Presigned URLs let the browser upload/download directly, bypassing the backend.

Two clients are needed in a Docker setup because the URL must be valid for
whoever connects:
  * the BROWSER reaches MinIO at the public host (e.g. localhost:9000), so
    presigned URLs must be SIGNED for that host — otherwise SigV4 fails.
  * the BACKEND container reaches MinIO at the internal host (minio:9000) for
    direct server-side reads.
"""

import uuid

import boto3
from botocore.config import Config

from app.core.config import settings

_config = Config(signature_version="s3v4", s3={"addressing_style": "path"})


def _make_client(endpoint: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=_config,
    )


# For presigned URLs handed to the browser — signed for the public host.
_s3_public = _make_client(settings.S3_PUBLIC_URL)
# For server-side reads from inside the Docker network.
_s3_internal = _make_client(settings.S3_ENDPOINT_URL)


def new_key(prefix: str, ext: str) -> str:
    return f"{prefix}/{uuid.uuid4().hex}.{ext.lstrip('.')}"


def presigned_put(key: str, content_type: str, expires: int = 900) -> str:
    return _s3_public.generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=expires,
    )


def presigned_get(key: str, expires: int = 3600) -> str:
    return _s3_public.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def download_bytes(key: str) -> bytes:
    obj = _s3_internal.get_object(Bucket=settings.S3_BUCKET, Key=key)
    return obj["Body"].read()


def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    """Server-side upload (used by seeding/admin tasks, not the normal flow)."""
    _s3_internal.put_object(
        Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType=content_type
    )


def list_objects(prefix: str):
    """Yield (key, last_modified) for every object under `prefix`."""
    paginator = _s3_internal.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            yield obj["Key"], obj["LastModified"]


def delete_keys(keys: list[str]) -> None:
    """Delete objects in batches (S3 allows up to 1000 per request)."""
    for i in range(0, len(keys), 1000):
        batch = [{"Key": k} for k in keys[i : i + 1000]]
        _s3_internal.delete_objects(Bucket=settings.S3_BUCKET, Delete={"Objects": batch})
