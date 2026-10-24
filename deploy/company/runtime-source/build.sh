#!/bin/sh
set -eu
export DEB_BUILD_MAINT_OPTIONS=hardening=+all
# Built on the exact runtime base; source builds retain upstream checks and regression probes.
fetch() { curl --fail --location --retry 5 --retry-all-errors "$2" --output "$3"; printf "%s  %s\n" "$1" "$3" | sha256sum -c -; }
copy_inventory() {
  package=$1
  destination=$2
  dpkg-query -L "$package" | while IFS= read -r entry; do
    if test -f "$entry" || test -L "$entry"; then
      # Normalize legacy inventory into the runtime base's merged /usr layout.
      case "$entry" in /bin/*|/sbin/*|/lib/*|/lib64/*) target=/usr$entry ;; *) target=$entry ;; esac
      mkdir -p "$destination$(dirname "$target")"
      cp -a "$entry" "$destination$target"
    fi
  done
}
preserve_controls() {
  control_package=$1
  control_destination=$2
  for control in preinst postinst prerm postrm triggers conffiles; do
    original=$(dpkg-query --control-path "$control_package" "$control" 2>/dev/null || true)
    if test -n "$original" && test -f "$original"; then cp -a "$original" "$control_destination/DEBIAN/$control"; fi
  done
  for field in Pre-Depends Recommends Suggests Enhances Breaks Conflicts Replaces Provides; do
    original=$(dpkg-query -W -f="\${$field}" "$control_package")
    if test -n "$original"; then printf '%s: %s\n' "$field" "$original" >> "$control_destination/DEBIAN/control"; fi
  done
}
build_pcre2() {
  fetch '929f0b20e62879252a15886b06c89f1edef61a363cbd5826fb041080a5e557ae' 'https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.49/pcre2-10.49.tar.gz' '/tmp/pcre2.tar.gz'
  mkdir /build
  tar -xzf /tmp/pcre2.tar.gz --strip-components=1 -C /build
  cd /build
  eval "$(dpkg-buildflags --export=sh)"
  ./configure --prefix=/usr --libdir=/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) --enable-jit --disable-static
  make -j2
  make check
  make DESTDIR=/stage install
  mkdir -p /pkg/DEBIAN /pkg/usr/share/doc/libpcre2-8-0 /pkg/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) /out
  copy_inventory libpcre2-8-0 /pkg
  rm -f /pkg/usr/lib/*/libpcre2-8.so.*
  cp -a /stage/usr/lib/*/libpcre2-8.so.* /pkg/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)/
  cp LICENCE.md /pkg/usr/share/doc/libpcre2-8-0/copyright
  mkdir -p debian
  printf 'Source: pcre2\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: libpcre2-8-0\nArchitecture: any\nDescription: PCRE2 runtime\n' > debian/control
  dependencies="$(dpkg-shlibdeps -O -e$(find /pkg/usr/lib -type f -name 'libpcre2-8.so.*') | sed -n 's/^shlibs:Depends=//p')"
  test -n "$dependencies"
  original_dependencies=$(dpkg-query -W -f='${Depends}' libpcre2-8-0)
  if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi
  printf 'Package: libpcre2-8-0\nSource: pcre2\nVersion: 10.49-1+runtime1\nArchitecture: %s\nMulti-Arch: same\nSection: libs\nPriority: optional\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: PCRE2 8-bit runtime built from verified upstream 10.49\n' "$(dpkg --print-architecture)" "$dependencies" > /pkg/DEBIAN/control
  printf 'libpcre2-8 0 libpcre2-8-0 (>= 10.49-1+runtime1)\n' > /pkg/DEBIAN/shlibs
  preserve_controls libpcre2-8-0 /pkg
  dpkg-deb --build --root-owner-group /pkg /out/pcre2.deb
}
build_tar() {
  fetch '4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16' 'https://ftp.gnu.org/gnu/tar/tar-1.35.tar.xz' '/tmp/tar.tar.xz'
  cp -a /runtime-source/tar-patches /patches
  cd /patches
  sha256sum -c SHA256SUMS
  mkdir /tarbuild
  tar -xJf /tmp/tar.tar.xz --strip-components=1 -C /tarbuild
  cd /tarbuild
  for patchfile in /patches/*.patch; do patch --batch -p1 < "$patchfile"; done
  autoreconf -v
  original_defaults=$(tar --show-defaults)
  original_rmt=$(printf '%s\n' "$original_defaults" | sed -n 's/.*--rmt-command=\([^ ]*\).*/\1/p')
  original_rsh=$(printf '%s\n' "$original_defaults" | sed -n 's/.*--rsh-command=\([^ ]*\).*/\1/p')
  test -n "$original_rmt" && test -n "$original_rsh"
  eval "$(dpkg-buildflags --export=sh)"
  FORCE_UNSAFE_CONFIGURE=1 ./configure --prefix=/usr --with-lzma='xz --format=lzma' DEFAULT_RMT_DIR="$(dirname "$original_rmt")" RSH="$original_rsh"
  make -j2
  src/tar --show-defaults | grep -F -- "--rmt-command=$original_rmt"
  src/tar --show-defaults | grep -F -- "--rsh-command=$original_rsh"
  # Run upstream tests without root so privileged-xattr checks correctly detect unavailable capabilities.
  chown -R nobody:nogroup /tarbuild
  runuser -u nobody -- make check
  mkdir -p /tarpkg/DEBIAN /tarpkg/usr/bin /tarpkg/usr/sbin /tarpkg/usr/share/doc/tar /out
  copy_inventory tar /tarpkg
  cp src/tar /tarpkg/usr/bin/tar
  cp rmt/rmt /tarpkg/usr/sbin/rmt-tar
  cp COPYING /tarpkg/usr/share/doc/tar/COPYING.upstream
  cp -a /patches /tarpkg/usr/share/doc/tar/patches
  mkdir -p debian
  printf 'Source: tar\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: tar\nArchitecture: any\nDescription: GNU tar runtime\n' > debian/control
  dependencies="$(dpkg-shlibdeps -O -e/tarpkg/usr/bin/tar -e/tarpkg/usr/sbin/rmt-tar | sed -n 's/^shlibs:Depends=//p')"
  test -n "$dependencies"
  original_dependencies=$(dpkg-query -W -f='${Depends}' tar)
  if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi
  printf 'Package: tar\nSource: tar\nVersion: 1.35+fedora10-1+runtime1\nArchitecture: %s\nEssential: yes\nSection: utils\nPriority: required\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: GNU tar with verified Fedora 1.35-10 security backports\n' "$(dpkg --print-architecture)" "$dependencies" > /tarpkg/DEBIAN/control
  preserve_controls tar /tarpkg
  dpkg-deb --build --root-owner-group /tarpkg /out/tar.deb
}
build_dash() {
  fetch '0d632f6b945058d84809cac7805326775bd60cb4a316907d0bd4228ff7107154' 'https://git.kernel.org/pub/scm/utils/dash/dash.git/snapshot/dash-0.5.12.tar.gz' '/tmp/dash.tar.gz'
  mkdir /shellbuild
  tar -xzf /tmp/dash.tar.gz --strip-components=1 -C /shellbuild
  cd /shellbuild
  autoreconf -fi
  eval "$(dpkg-buildflags --export=sh)"
  ./configure --prefix=/usr --enable-fnmatch
  make -j2
  nm -D src/dash | grep -w fnmatch
  src/dash -c 'set -eu; value=alpha; case "$value" in a*[!0-9]) ;; *) exit 1;; esac; f() { printf "%s" "$1"; }; test "$(f quoted)" = quoted; test "$(printf "%s\n" pipeline | sed s/line//)" = pipe; test "$(printf "\\u20ac")" = "\u20ac"; d=$(mktemp -d); cd "$d"; touch alpha.txt beta.txt; set -- *.txt; test "$#" = 2; test "$1" = alpha.txt'
  timeout 5 src/dash -c 'value=$(printf "%050000d" 0 | tr 0 .); case "$value" in *.*.*.*.*.tar.gz) exit 1;; *) printf "libc matcher stress passed\n";; esac'
  mkdir -p /shellpkg/DEBIAN /shellpkg/usr/bin /out
  copy_inventory dash /shellpkg
  cp src/dash /shellpkg/usr/bin/dash
  cp COPYING /shellpkg/usr/share/doc/dash/COPYING.upstream
  mkdir -p debian
  printf 'Source: dash\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: dash\nArchitecture: any\nDescription: POSIX shell with libc matcher\n' > debian/control
  dependencies="$(dpkg-shlibdeps -O -e/shellpkg/usr/bin/dash | sed -n 's/^shlibs:Depends=//p')"
  test -n "$dependencies"
  original_dependencies=$(dpkg-query -W -f='${Depends}' dash)
  if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi
  printf 'Package: dash\nSource: dash\nVersion: 0.5.12+libcfnmatch-1+runtime1\nArchitecture: %s\nEssential: yes\nSection: shells\nPriority: required\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: Upstream dash 0.5.12 with libc fnmatch enabled\n' "$(dpkg --print-architecture)" "$dependencies" > /shellpkg/DEBIAN/control
  preserve_controls dash /shellpkg
  dpkg-deb --build --root-owner-group /shellpkg /out/dash.deb
}
build_expat() {
  fetch '16afbb9cefead2aa278105cf27d9f597bde7fbf3dbb85015857ca7ca6a4e89ba' 'https://github.com/libexpat/libexpat/releases/download/R_2_9_0/expat-2.9.0.tar.gz' '/tmp/expat.tar.gz'
  mkdir /xmlbuild
  tar -xzf /tmp/expat.tar.gz --strip-components=1 -C /xmlbuild
  cd /xmlbuild
  cp -a /runtime-source/expat-patches /expat-patches
  cd /expat-patches
  sha256sum -c SHA256SUMS
  cd /xmlbuild
  patch --batch --fuzz=0 -p2 < /expat-patches/00-amplification.patch
  patch --batch --fuzz=0 -p2 < /expat-patches/01-reset.patch
  eval "$(dpkg-buildflags --export=sh)"
  ./configure --prefix=/usr --libdir=/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) --disable-static --without-docbook
  make -j2
  make check
  make DESTDIR=/xmlstage install
  cc -UNDEBUG -D_POSIX_C_SOURCE=200809L -Ilib -I. /expat-patches/check-expat.c -Llib/.libs -Wl,-rpath,/xmlbuild/lib/.libs -lexpat -o /check-expat
  timeout 15 /check-expat
  mkdir -p /xmlpkg/DEBIAN /xmlpkg/usr/share/doc/libexpat1 /xmlpkg/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH) /out
  copy_inventory libexpat1 /xmlpkg
  rm -f /xmlpkg/usr/lib/*/libexpat.so.*
  cp -a /xmlstage/usr/lib/*/libexpat.so.* /xmlpkg/usr/lib/$(dpkg-architecture -qDEB_HOST_MULTIARCH)/
  cp COPYING /xmlpkg/usr/share/doc/libexpat1/copyright
  cp -a /expat-patches /xmlpkg/usr/share/doc/libexpat1/patches
  mkdir -p debian
  printf 'Source: expat\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\nPackage: libexpat1\nArchitecture: any\nDescription: Expat XML runtime\n' > debian/control
  dependencies="$(dpkg-shlibdeps -O -e$(find /xmlpkg/usr/lib -type f -name 'libexpat.so.*') | sed -n 's/^shlibs:Depends=//p')"
  test -n "$dependencies"
  original_dependencies="$(dpkg-query -W -f='${Depends}' libexpat1)"
  if test -n "$original_dependencies"; then dependencies="$original_dependencies, $dependencies"; fi
  printf 'Package: libexpat1\nSource: expat\nVersion: 2.9.0+security20261023-1+runtime1\nArchitecture: %s\nMulti-Arch: same\nSection: libs\nPriority: optional\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\nDepends: %s\nDescription: Expat runtime built from verified upstream 2.9.0\n' "$(dpkg --print-architecture)" "$dependencies" > /xmlpkg/DEBIAN/control
  printf 'libexpat 1 libexpat1 (>= 2.9.0+security20261023-1+runtime1)\n' > /xmlpkg/DEBIAN/shlibs
  preserve_controls libexpat1 /xmlpkg
  dpkg-deb --build --root-owner-group /xmlpkg /out/expat.deb
}
case "${1-}" in
 coreutils|ncurses) sh /runtime-source/utility-source/build-utilities.sh "$1" ;;
 expat) build_expat ;;
 pcre2) build_pcre2 ;;
 tar) build_tar ;;
 dash) build_dash ;;
 *) printf "Expected pcre2, tar, dash, expat, coreutils or ncurses\n" >&2; exit 2 ;;
esac
