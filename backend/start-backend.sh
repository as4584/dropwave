#!/bin/bash
# Keep the DropWave backend running 24/7. Idempotent — safe to run often.
set -u
cd "$(dirname "$0")" || exit 1

if pgrep -f "uvicorn main:app" > /dev/null 2>&1; then
  if curl -s --max-time 8 http://localhost:8001/health 2>/dev/null | grep -q '"ok":true'; then
    exit 0
  fi
  pkill -9 -f "uvicorn main:app" 2>/dev/null
  sleep 2
fi

setsid nohup ./run.sh > /tmp/dropwave-backend.log 2>&1 < /dev/null &
disown 2>/dev/null
echo "dropwave backend (re)started"
