"""Ensure tests import the live, volume-mounted source (/app) rather than the
pip-installed snapshot in site-packages — matching how uvicorn/celery run in dev."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

# Unit tests must import app modules without a real .env (e.g. on CI, where no
# secrets are present). Provide harmless dummy values for the required settings;
# setdefault keeps real values when running under docker-compose.
for _key, _val in {
    "DATABASE_URL": "postgresql+psycopg2://test:test@localhost/test",
    "S3_ENDPOINT_URL": "http://localhost:9000",
    "S3_PUBLIC_URL": "http://localhost:9000",
    "S3_ACCESS_KEY": "test",
    "S3_SECRET_KEY": "test",
    "SECRET_KEY": "test-secret-key",
}.items():
    os.environ.setdefault(_key, _val)
