# FloodCast Gurugram — backend image.
#
# Multi-stage so the runtime image carries no compiler toolchain: pyarrow
# and duckdb need build tooling to install but nothing at run time, and
# shipping gcc into production is unnecessary attack surface.

# ── Build stage ──────────────────────────────────────────────────────
FROM python:3.11-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime stage ────────────────────────────────────────────────────
FROM python:3.11-slim

# Run as a non-root user. The app writes only to var/, so nothing else
# needs to be writable.
RUN useradd --create-home --uid 10001 floodcast

COPY --from=build /install /usr/local

WORKDIR /app
COPY --chown=floodcast:floodcast . .

# Runtime state directory for the citizen report store.
RUN mkdir -p /app/var && chown floodcast:floodcast /app/var

USER floodcast

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000

EXPOSE 10000

# Render injects $PORT; the default keeps `docker run` working locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
