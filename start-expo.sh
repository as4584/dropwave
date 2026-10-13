#!/bin/bash
# Keep the DropWave Expo Go server running 24/7. Idempotent — safe to run often.
# Serves the native app to Expo Go via ngrok tunnel (own agent on API port 4041,
# isolated from the tracker agent on 4040 so tracker restarts can't wipe it).
set -u
cd "$HOME/workspace/apps/music-app" || exit 1

if [ -f "$HOME/.config/expo-vm.env" ]; then
  set -a; . "$HOME/.config/expo-vm.env"; set +a
else
  echo "missing expo token file" >&2; exit 1
fi
if [ -f "$HOME/.config/ngrok.env" ]; then
  set -a; . "$HOME/.config/ngrok.env"; set +a
fi
export NGROK_AUTHTOKEN="${NGROK_AUTHTOKEN:-}"

# The phone app must reach the backend through its public tunnel URL.
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://dropwave-api-as4584-8001.exp.direct}"

NGROK_BIN="$(find /usr/lib/node_modules/@expo/ngrok -path '*/ngrok-bin-linux-x64/ngrok' -type f 2>/dev/null | head -1)"

# The reserved dropwave-api backend tunnel lives on our own ngrok agent (API
# port 4041), independent of Expo's agent so the backend survives expo restarts.
ensure_dropwave_agent() {
  curl -s --max-time 5 "http://localhost:4041/api/tunnels" > /dev/null 2>&1 && return 0
  TOKEN="$(grep '^authtoken:' "$HOME/.expo/ngrok.yml" 2>/dev/null | awk '{print $2}')"
  if [ -z "$TOKEN" ] || [ -z "$NGROK_BIN" ]; then echo "cannot start dropwave ngrok agent" >&2; return 1; fi
  printf 'web_addr: 127.0.0.1:4041\nauthtoken: %s\n' "$TOKEN" > /tmp/dropwave-ngrok.yml
  chmod 600 /tmp/dropwave-ngrok.yml
  setsid nohup "$NGROK_BIN" start --none --log=stdout --config=/tmp/dropwave-ngrok.yml > /tmp/dropwave-ngrok.log 2>&1 < /dev/null &
  disown 2>/dev/null
  sleep 8
  curl -s --max-time 5 "http://localhost:4041/api/tunnels" > /dev/null 2>&1
}
# (Re)install the tunnel package BEFORE ensure_dropwave_agent — global npm does
# not survive VM replacement, and the agent start needs the ngrok binary.
npm ls -g @expo/ngrok > /dev/null 2>&1 || npm install -g @expo/ngrok@^4.1.0 > /dev/null 2>&1
ensure_dropwave_agent || true

# Find the Expo tunnel URL. Expo spawns its own ngrok agent on the first free
# API port (4040+), so scan a few ports. Only match tunnels for this app's
# port 8090 (the tracker agent on 4040 and the dropwave-api tunnel are skipped).
# The hostname rotates on restart.
get_tunnel_url() {
  for port in 4040 4041 4042 4043 4044 4045; do
    URL="$(curl -s --max-time 5 "http://localhost:$port/api/tunnels" 2>/dev/null \
      | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    ts=[t['public_url'] for t in d.get('tunnels',[]) if t.get('public_url','').startswith('https') and '-8090.' in t.get('public_url','')]
    print(ts[0] if ts else '')
except Exception: print('')
" 2>/dev/null)"
    if [ -n "$URL" ]; then echo "$URL"; return 0; fi
  done
  echo ""
}

# Already healthy? Expo running AND tunnel manifest serves to Expo Go.
if pgrep -f "ex[p]o start --tunnel.*8090" > /dev/null 2>&1; then
  URL="$(get_tunnel_url)"
  if [ -n "$URL" ] && curl -s --max-time 12 -H "expo-platform: ios" \
      "$URL" 2>/dev/null | grep -q '"launchAsset"'; then
    # Re-ensure the backend API tunnel on this agent too.
    if ! curl -s --max-time 8 "http://localhost:4041/api/tunnels" 2>/dev/null \
        | grep -q '"name":"dropwave-api"'; then
      curl -s --max-time 15 -X POST "http://localhost:4041/api/tunnels" \
        -H "Content-Type: application/json" \
        -d '{"name":"dropwave-api","proto":"http","addr":"http://localhost:8001","hostname":"dropwave-api-as4584-8001.exp.direct"}' > /dev/null
    fi
    exit 0
  fi
fi

# Clear anything stale, then start fully detached so it outlives this script.
# --no-dev serves a production bundle (faster loads on the phone).
pkill -9 -f "ex[p]o start --tunnel.*8090" 2>/dev/null
sleep 2
setsid nohup npx expo start --tunnel --no-dev --port 8090 \
  > /tmp/dropwave-expo.log 2>&1 < /dev/null &
disown 2>/dev/null
echo "dropwave expo (re)started"

# Warm up both platform bundles in the background. First-request Hermes
# bytecode compile takes ~30s and phones time out ("Could not connect").
# Pre-compiling here means the first real user never hits a cold server.
(
  sleep 25  # let Metro and the tunnel come up
  for i in $(seq 1 20); do
    URL="$(get_tunnel_url)"
    [ -n "$URL" ] && break
    sleep 10
  done
  [ -z "$URL" ] && exit 0
  for PLATFORM in ios android; do
    curl -s --max-time 120 -o /dev/null \
      "$URL/node_modules/expo-router/entry.bundle?platform=$PLATFORM&dev=false&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable"
  done
) > /dev/null 2>&1 &
disown 2>/dev/null
echo "bundle warm-up started"
