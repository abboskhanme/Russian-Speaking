FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps: ffmpeg for audio conversion, libpq for psycopg2,
# libasound2 + libssl + ca-certificates are runtime libs the Azure Speech SDK needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libpq-dev \
    gcc \
    libasound2 \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the package source before installing so setuptools can build it.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --upgrade pip && pip install ".[dev]"

# Copy the rest (alembic config, etc.). In dev the whole dir is volume-mounted,
# so live code edits are picked up without rebuilding.
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
