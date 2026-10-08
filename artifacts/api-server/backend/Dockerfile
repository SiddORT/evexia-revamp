FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY pyproject.toml uv.lock /workspace/

RUN pip install --no-cache-dir uv \
    && cd /workspace \
    && uv sync --frozen --no-dev

COPY artifacts/api-server/backend /app

EXPOSE 8080

CMD ["uv", "run", "--project", "/workspace", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
