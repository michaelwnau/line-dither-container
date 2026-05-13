FROM python:3.12-slim

LABEL org.opencontainers.image.title="line-dither" \
      org.opencontainers.image.description="Line-dither: image -> SVG scanline dither"

# Non-root user for rootless Podman
RUN useradd --create-home --shell /bin/bash app

WORKDIR /app

# System deps for Pillow (JPEG/PNG/WebP decode)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libjpeg-turbo-progs \
      libpng-dev \
      libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source - all flat in build context root
COPY --chown=app:app dither.py app.py index.html ./

USER app

EXPOSE 5000

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=5000

CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--workers", "2", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "app:app"]
