#!/bin/bash
# paired.sh <label> <vitest args...>: one timed vitest run, its Duration line and pass counts.
label=$1; shift
s=$(date +%s.%N)
node node_modules/vitest/vitest.mjs run "$@" > "$RUNNER_TEMP/out.txt" 2>&1; rc=$?
e=$(date +%s.%N)
sed 's/\x1b\[[0-9;]*m//g' "$RUNNER_TEMP/out.txt" | grep -E "^ +(Test Files|Tests|Duration)" | tr -s ' ' | tr '\n' '|' > "$RUNNER_TEMP/sum.txt"
echo "PAIRED $label wall $(echo "$e - $s" | bc) rc=$rc $(cat "$RUNNER_TEMP/sum.txt")"
