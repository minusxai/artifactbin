#!/bin/sh
set -eu
export DEBIAN_FRONTEND=noninteractive DEB_BUILD_MAINT_OPTIONS=hardening=+all,-pie
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
(cd "$here" && sha256sum -c SHA256SUMS)
mkdir -p /cups-work /out;cd /cups-work
# Capture eligibility with dpkg-query before bootstrapping Python/build tools.
: > /cups-work/runtime-profile.tsv
for package in libcups2t64;do
 if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)" = installed ];then
  dpkg-query -W -f='${Package}\t${Version}\n' "$package" >> /cups-work/runtime-profile.tsv
 fi
done
if [ ! -s /cups-work/runtime-profile.tsv ];then echo 'No existing eligible runtime packages';exit 0;fi
export RUNTIME_PROFILE_TSV=/cups-work/runtime-profile.tsv
apt-get update
apt-get install -y --no-install-recommends python3 dpkg-dev binutils
python3 "$here/package-cups.py" snapshot /cups-work/baseline.json
apt-get update
apt-get install -y --no-install-recommends build-essential dpkg-dev pkg-config python3 ca-certificates gnupg libgnutls28-dev libkrb5-dev libavahi-client-dev libavahi-common-dev zlib1g-dev
python3 "$here/fetch-cups.py" "$here" /cups-work
mkdir -m700 -p /cups-work/gnupg;export GNUPGHOME=/cups-work/gnupg
gpg --batch --import "$here/release-key.asc"
gpg --batch --verify cups-2.4.20-source.tar.gz.sig cups-2.4.20-source.tar.gz
tar -xf cups-2.4.20-source.tar.gz
cd cups-2.4.20
export CFLAGS="$(dpkg-buildflags --get CFLAGS)" CPPFLAGS="$(dpkg-buildflags --get CPPFLAGS)" LDFLAGS="$(dpkg-buildflags --get LDFLAGS)" DSOFLAGS="$(dpkg-buildflags --get LDFLAGS)"
triplet=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
./configure --prefix=/usr --libdir="/usr/lib/$triplet" --sysconfdir=/etc --localstatedir=/var --with-tls=gnutls --with-dnssd=avahi --enable-gssapi --enable-threads --enable-static --enable-debug --disable-launchd
# Build the shared client library and upstream ordinary array regression only.
# No daemon/backend is installed or executed; no malformed-input reproductions.
make -C cups -j"${CUPS_JOBS:-2}" libcups.so.2 testarray
mkdir -p /cups-work/stage/usr/lib/"$triplet"
install -m755 cups/libcups.so.2 /cups-work/stage/usr/lib/"$triplet"/libcups.so.2
cc $(dpkg-buildflags --get CPPFLAGS) $(dpkg-buildflags --get CFLAGS) -I. "$here/check-ipp.c" -Lcups -lcups $(dpkg-buildflags --get LDFLAGS) -o /out/check-ipp
LD_LIBRARY_PATH="/cups-work/stage/usr/lib/$triplet" python3 "$here/check-cups.py" /out/check-ipp --library "/cups-work/stage/usr/lib/$triplet/libcups.so.2"
cd /cups-work
python3 "$here/package-cups.py" package /cups-work/baseline.json
