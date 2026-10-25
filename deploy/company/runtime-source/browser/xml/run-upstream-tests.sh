#!/bin/sh
# Required full upstream suite on the already configured Debian native build.
set -eu
build=${1:?configured build directory required}
out=${2:?absolute proof output directory required}
cd "$build"
# check builds its check_PROGRAMS; ordinary Debian `make all` does not.
[ -e xmlconf ] || ln -s ../../xmlconf xmlconf
if make -j2 check > "$out/xml-upstream-check.log" 2>&1; then :; else
 status=$?; cat "$out/xml-upstream-check.log" >&2; exit "$status"
fi
# Require nonempty W3C coverage, and run the catalog-specific regression binary
# which is a check_PROGRAM but not executed by this release's runtests recipe.
if ./runxmlconf > "$out/xml-conformance.log" 2>&1; then :; else
 status=$?; cat "$out/xml-conformance.log" >&2; exit "$status"
fi
grep -q '^Total 2269 tests, 15 errors, 0 leaks$' "$out/xml-conformance.log"
grep -q '^15 errors were expected$' "$out/xml-conformance.log"
./testcatalog
