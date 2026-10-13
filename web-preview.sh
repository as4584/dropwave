#!/bin/bash
# Serve the DropWave static web preview on port 8083. Idempotent.
# Build first: npx expo export --platform web
# Point the app at a reachable backend at export time:
#   EXPO_PUBLIC_API_URL=http://<host>:8001 npx expo export --platform web
# Uses preview/spa-server.py so deep routes (e.g. /download) serve index.html.
set -u
cd "$HOME/workspace/apps/music-app" || exit 1

if [ ! -d dist ]; then
  echo "dist/ not found. Run: npx expo export --platform web" >&2
  exit 1
fi

if curl -s --max-time 5 http://localhost:8083/ > /dev/null 2>&1; then
  exit 0
fi

# Clear anything stale, then start fully detached.
pkill -f "spa-server.py" 2>/dev/null
sleep 1
setsid nohup python3 preview/spa-server.py > /tmp/dropwave-web.log 2>&1 < /dev/null &
disown 2>/dev/null
echo "dropwave web preview (re)started on :8083"
