#!/bin/sh
# Opens the Rook Test Bench, starting the local site server first if it isn't already running.
# Usage: tools/rook-test/run.sh

cd "$(dirname "$0")/../.." || exit 1
PORT=8765
URL="http://localhost:$PORT/tools/rook-test/"

if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  echo "Started the local server on port $PORT (stop it with: kill $!)"
  sleep 1
fi

echo "Opening $URL"
open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
