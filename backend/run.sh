#!/bin/bash
# DropWave backend: FastAPI + yt-dlp on port 8001.
set -u
cd "$(dirname "$0")" || exit 1
if [ ! -x "venv/bin/uvicorn" ]; then
  python3 -m venv venv
  ./venv/bin/pip install --quiet fastapi "uvicorn[standard]" yt-dlp
fi
exec ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001
