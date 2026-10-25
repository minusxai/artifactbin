#!/bin/sh
# Run in the final runtime, with fixture binary mounted only for the test.
set -eu
probe=${1:-/out/check-xorg}
fixture=$(mktemp -d)
server=
cleanup() {
  [ -z "$server" ] || kill "$server" 2>/dev/null || :
  [ -z "$server" ] || wait "$server" 2>/dev/null || :
  rm -rf "$fixture"
}
trap cleanup EXIT HUP INT TERM
Xvfb -displayfd 3 -screen 0 1280x1024x24 -nolisten tcp -ac 3>"$fixture/display" >"$fixture/server.log" 2>&1 &
server=$!
for attempt in $(seq 1 100); do
  [ ! -s "$fixture/display" ] || break
  if ! kill -0 "$server" 2>/dev/null; then cat "$fixture/server.log"; exit 1; fi
  sleep 0.1
done
[ -s "$fixture/display" ] || { cat "$fixture/server.log"; exit 1; }
export DISPLAY=:$(cat "$fixture/display")
LIBGL_ALWAYS_SOFTWARE=1 "$probe"
# Xvfb itself invokes the installed xkbcomp; also verify its normal public
# compile/decompile interface against the live server and preserved XKB data.
xkbcomp -xkb "$DISPLAY" "$fixture/current.xkb"
xkbcomp "$fixture/current.xkb" "$fixture/roundtrip.xkm"
xkbcomp "$fixture/roundtrip.xkm" "$DISPLAY"
xkbcomp -xkb "$DISPLAY" "$fixture/restored.xkb"
[ -s "$fixture/current.xkb" ] && [ -s "$fixture/roundtrip.xkm" ] && [ -s "$fixture/restored.xkb" ]
