FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets $PORT at runtime; uvicorn must bind to it, not a hardcoded
# port (unlike the backend's Dockerfile, which can EXPOSE a fixed 3000
# since Nest's own main.ts already reads process.env.PORT itself - FastAPI/
# uvicorn needs the bind target passed on the command line instead).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
