#!/bin/bash
# Recreate DropWave preview tunnels on the Expo ngrok agent.
# The agent API moves between 4040/4041; the ACL only permits *.exp.direct hostnames.
set -u
for port in 4040 4041; do
  if curl -s --max-time 5 "http://localhost:$port/api/tunnels" | grep -q '"tunnels"'; then
    API="http://localhost:$port/api/tunnels"
    break
  fi
done
if [ -z "${API:-}" ]; then echo "ngrok agent API not found" >&2; exit 1; fi
has() { curl -s --max-time 8 "$API" | grep -q "\"name\":\"$1\""; }
if ! has "dropwave-web"; then
  curl -s --max-time 15 -X POST "$API" -H "Content-Type: application/json" \
    -d '{"name":"dropwave-web","proto":"http","addr":"http://localhost:8083","hostname":"dropwave-as4584-8083.exp.direct"}' > /dev/null
  echo "dropwave-web tunnel ensured"
fi
if ! has "dropwave-api"; then
  curl -s --max-time 15 -X POST "$API" -H "Content-Type: application/json" \
    -d '{"name":"dropwave-api","proto":"http","addr":"http://localhost:8001","hostname":"dropwave-api-as4584-8001.exp.direct"}' > /dev/null
  echo "dropwave-api tunnel ensured"
fi
echo "web: https://dropwave-as4584-8083.exp.direct"
echo "api: https://dropwave-api-as4584-8001.exp.direct"
