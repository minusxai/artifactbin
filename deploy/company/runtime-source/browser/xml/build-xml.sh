#!/bin/sh
# Run only in a disposable builder based on the consumer's exact Debian image.
set -eu
recipe=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out=${1:?output directory required}
test "$(dpkg-query -W -f='${db:Status-Status}' libxml2)" = installed
old_library=$(dpkg-query -L libxml2 | sed -n '\|/libxml2\.so\.2\.[0-9]*\.[0-9]*$|p')
test -f "$old_library"
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
# Freeze the actual runtime bytes before installing inspection/build tools.
# Minimal consumer images do not necessarily contain objdump yet.
cp -L "$old_library" "$out/libxml2-before.so"
sha256sum "$out/libxml2-before.so" > "$out/libxml2-before.sha256"
apt-get update
apt-get install -y --no-install-recommends build-essential dpkg-dev debhelper autoconf automake libtool pkg-config liblzma-dev zlib1g-dev rename python3 ca-certificates curl
objdump -T "$out/libxml2-before.so" > "$out/libxml2-before.exports"
python3 "$recipe/prepare.py" /xml-source
cd /xml-source/libxml2
export DEB_BUILD_PROFILES=nopython
export DEB_BUILD_OPTIONS=parallel=2
dpkg-buildpackage -B -us -uc
# The upstream W3C driver succeeds with zero cases when its relative fixture is
# absent. Debian's out-of-tree build links test/result, but not this directory.
ln -s ../../xmlconf builddir/main/xmlconf
(cd builddir/main && ./runxmlconf) > "$out/xml-conformance.log" 2>&1
grep -q '^Total 2269 tests, 15 errors, 0 leaks$' "$out/xml-conformance.log"
grep -q '^15 errors were expected$' "$out/xml-conformance.log"
(cd builddir/main && ./testcatalog)
package=$(find .. -maxdepth 1 -name 'libxml2_*_*.deb' -print)
test -n "$package"
dpkg-deb -x "$package" /xml-runtime
new_library=$(find /xml-runtime/usr/lib -type f -name 'libxml2.so.2.*')
test -f "$new_library"
objdump -T "$new_library" > "$out/libxml2-after.exports"
python3 "$recipe/verify-exports.py" "$out/libxml2-before.exports" "$out/libxml2-after.exports"
cc -O2 -UNDEBUG -Iinclude "$recipe/check-xml.c" "$new_library" -Wl,-rpath,"$(dirname "$new_library")" -o /xml-public-api-check
/xml-public-api-check
cp "$package" "$out/libxml2.deb"
cp "$recipe/patches/SHA256SUMS" "$out/libxml2-patch-sha256.txt"
printf '%s\n' 'Debian package build, upstream tests, symbol-version compatibility and XML public APIs passed.'
