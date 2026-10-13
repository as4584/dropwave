#!/bin/bash
# Ensure the DropWave expo tunnel is running. Idempotent — safe to run often.
# Modeled on the tracker app's start-tunnel.sh. Serves port 8082 (tracker uses 8081).
set -u
cd "$HOME/workspace/apps/music-app" || exit 1
if [ -f "$HOME/.config/expo-vm.env" ]; then
  set -a; . "$HOME/.config/expo-vm.env"; set +a
fi

# Already healthy? Process running — tunnel takes a few minutes to stabilize,
# so skip the manifest check for the first 3 minutes after start.
if pgrep -f "ex[p]o start --tunnel --port 8082" > /dev/null 2>&1; then
  PID="$(pgrep -f "ex[p]o start --tunnel --port 8082" | head -1)"
  ELAPSED="$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')"
  ELAPSED="${ELAPSED:-999999}"
  if [ "$ELAPSED" -lt 180 ]; then
    exit 0
  fi
  for port in 4040 4041; do
    URL="$(curl -s --max-time 8 "http://localhost:$port/api/tunnels" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); ts=[t['public_url'] for t in d.get('tunnels',[]) if 'exp.direct' in t['public_url']]; print(ts[0] if ts else '')" 2>/dev/null)"
    if [ -n "$URL" ] && curl -s --max-time 12 "$URL/" 2>/dev/null | grep -q '"launchAsset"'; then
      exit 0
    fi
  done
fi

# (Re)install the tunnel package — global npm does not survive VM replacement.
npm ls -g @expo/ngrok > /dev/null 2>&1 || npm install -g @expo/ngrok@^4.1.0 > /dev/null 2>&1

# Clear anything stale, then start fully detached so it outlives this script.
# --no-dev serves a production bundle (smaller/faster on Lex's phone).
pkill -9 -f "ex[p]o start --tunnel --port 8082" 2>/dev/null
sleep 2
setsid nohup npx expo start --tunnel --port 8082 --no-dev > /tmp/dropwave-expo.log 2>&1 < /dev/null &
disown 2>/dev/null
echo "dropwave expo tunnel (re)started"
