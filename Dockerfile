# ── Backend: FastAPI + 22-signal Recommendation Engine ──
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir sentence-transformers python-multipart

COPY fashion_ai/ ./fashion_ai/
COPY catalog_for_xpectrum.csv .

EXPOSE 8000

CMD ["uvicorn", "fashion_ai.app:app", "--host", "0.0.0.0", "--port", "8000"]
