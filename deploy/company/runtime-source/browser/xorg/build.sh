#!/bin/sh
# Compile on the exact final Debian base after capture-profile.sh and build prerequisites.
set -eu
scripts=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
profile=${XORG_PROFILE:-/xorg-profile}
stage=${XORG_STAGE:-/xorg-stage}
out=${XORG_OUT:-/out}
[ -f "$profile/packages.tsv" ] || { echo 'Capture the runtime profile before builder apt installs' >&2; exit 1; }
# libXpm's enabled translation targets invoke xgettext.
command -v xgettext >/dev/null || { echo 'Missing builder gettext tool: xgettext' >&2; exit 1; }
export DEB_BUILD_MAINT_OPTIONS=hardening=+all
export CFLAGS="$(dpkg-buildflags --get CFLAGS)"
export CPPFLAGS="$(dpkg-buildflags --get CPPFLAGS)"
export LDFLAGS="$(dpkg-buildflags --get LDFLAGS)"
triplet=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
mkdir -p "$stage" "$out" /xorg-build
export CFLAGS="$CFLAGS -I$stage/usr/include"
export LDFLAGS="$LDFLAGS -L$stage/usr/lib/$triplet"
fetch() {
  curl --fail --silent --show-error --location --retry 3 "$2" -o "$3"
  printf '%s  %s\n' "$1" "$3" | sha256sum --check
}
export PKG_CONFIG_PATH="$stage/usr/lib/$triplet/pkgconfig:$stage/usr/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export LD_LIBRARY_PATH="$stage/usr/lib/$triplet${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
for entry in \
 'libX11|1.8.14|bbc78c46217174655c2b32b138ad119f3ac15f50808b4d0b3a2677a4b1afc950' \
 'libXi|1.8.4|ddd6057b89a91903bc2f884d55c8467440906945e482c36547260dff28661afc' \
 'libXpm|3.5.20|c064ead03e4dde78afdeb121fe0b644d25c550444cf903fbdc537f1a78f3ef74' \
 'libXrender|0.9.13|3fe88c609df6782e1e7af2e4de36b2563d70cd70ff7dcb1cda561ad64912bb64'; do
  name=${entry%%|*}; rest=${entry#*|}; version=${rest%%|*}; checksum=${rest#*|}
  archive=/xorg-build/$name.tar.xz
  fetch "$checksum" "https://www.x.org/releases/individual/lib/$name-$version.tar.xz" "$archive"
  mkdir "/xorg-build/$name" && tar -xJf "$archive" --strip-components=1 -C "/xorg-build/$name"
  cd "/xorg-build/$name"
  # Retain upstream/Debian library features, including Xlib threads/locales and Xpm gzip input.
  configure_extra=
  [ "$name" != libX11 ] || configure_extra="--disable-specs --without-fop"
  ./configure --prefix=/usr --libdir="/usr/lib/$triplet" --enable-static --enable-shared $configure_extra
  make -j2
  make check
  make DESTDIR="$stage" install
  cd "$scripts"
done
if [ -d "$profile/x11-xkb-utils" ]; then
  # The actual Debian baseline contains xkbcomp1.4.7. Reproduce all four
  # faulty expression contracts before testing the new release on the same ABI.
  fetch 27ae7efb512f3b816c66b7c7290f28de4ae811972e06c5e27a9124d2eab766d4 https://deb.debian.org/debian/pool/main/x/x11-xkb-utils/x11-xkb-utils_7.7+9.tar.xz /xorg-build/xkb-baseline.tar.xz
  mkdir /xorg-build/xkb-baseline
  tar -xJf /xorg-build/xkb-baseline.tar.xz --strip-components=2 -C /xorg-build/xkb-baseline x11-xkb-utils.git/xkbcomp
  cd /xorg-build/xkb-baseline
  autoreconf -fi
  ./configure --prefix=/usr --with-xkb-config-root=/usr/share/X11/xkb
  make -j2
  ./xkbcomp -version
  cc $CFLAGS $CPPFLAGS -O0 -fno-optimize-sibling-calls -UNDEBUG -DHAVE_CONFIG_H -ffunction-sections -fdata-sections -I. \
    "$scripts/check-xkb-expressions.c" utils.c -L"$stage/usr/lib/$triplet" $LDFLAGS \
    -Wl,--gc-sections -lX11 -lxkbfile -o /out/check-xkb-baseline
  ulimit -c 0
  for fixture in boolean-negation invalid-identifier invalid-field-atoms missing-modmask-arguments; do
    if timeout 5 /out/check-xkb-baseline "$fixture"; then
      echo "Unexpected baseline acceptance: $fixture" >&2; exit 1
    else
      status=$?
      case "$status" in 134|139) printf 'Baseline expression %s reproduced failure %s\n' "$fixture" "$status";;
        *) echo "Unexpected baseline failure: $fixture status=$status" >&2; exit 1;;
      esac
    fi
  done
  cd "$scripts"
  fetch 2ac31f26600776db6d9cd79b3fcd272263faebac7eb85fb2f33c7141b8486060 https://www.x.org/releases/individual/app/xkbcomp-1.5.0.tar.xz /xorg-build/xkbcomp.tar.xz
  mkdir /xorg-build/xkbcomp && tar -xJf /xorg-build/xkbcomp.tar.xz --strip-components=1 -C /xorg-build/xkbcomp
  cd /xorg-build/xkbcomp
  ./configure --prefix=/usr --libdir="/usr/lib/$triplet" --with-xkb-config-root=/usr/share/X11/xkb
  make -j2
  make check
  # No native upstream test target is provided; exercise the actual fixed
  # expression routines with crafted inputs under an external wall-clock bound.
  cc $CFLAGS $CPPFLAGS -O0 -fno-optimize-sibling-calls -UNDEBUG -DHAVE_CONFIG_H -ffunction-sections -fdata-sections -I. \
    "$scripts/check-xkb-expressions.c" utils.c -L"$stage/usr/lib/$triplet" $LDFLAGS \
    -Wl,--gc-sections -lX11 -lxkbfile -o /out/check-xkb-expressions
  for fixture in boolean-negation invalid-identifier invalid-field-atoms missing-modmask-arguments; do
    timeout 5 /out/check-xkb-expressions "$fixture"
  done
  make pkgconfigdir=/usr/share/pkgconfig DESTDIR="$stage" install
  cd "$scripts"
fi
if [ -d "$profile/xvfb" ]; then
  fetch 6ad4e3c7b59a309b32c92e5c15ce1267110f9e13f1ac78da62361a628da1a0eb https://www.x.org/releases/individual/xserver/xorg-server-21.1.25.tar.xz /xorg-build/xserver.tar.xz
  mkdir /xorg-build/xserver && tar -xJf /xorg-build/xserver.tar.xz --strip-components=1 -C /xorg-build/xserver
  meson setup /xorg-build/xserver/build /xorg-build/xserver \
    --prefix=/usr --libdir="lib/$triplet" --libexecdir=lib/xorg \
    -Dxorg=false -Dxnest=false -Dxephyr=false -Dxwin=false -Dxquartz=false -Dxvfb=true \
    -Dglx=true -Dglamor=true -Dxdmcp=true -Dxdm-auth-1=true -Dxcsecurity=true -Dxace=true \
    -Dmitshm=true -Dxinerama=true -Dxselinux=true \
    -Dxres=true -Ddpms=true -Dscreensaver=true -Dxv=true -Dxvmc=true \
    -Ddri1=true -Ddri2=true -Ddri3=true -Dlibunwind=true \
    -Dxkb_dir=/usr/share/X11/xkb -Dxkb_output_dir=/var/lib/xkb -Dxkb_bin_dir=/usr/bin \
    -Ddefault_font_path='/usr/share/fonts/X11/misc,/usr/share/fonts/X11/cyrillic,/usr/share/fonts/X11/100dpi/:unscaled,/usr/share/fonts/X11/75dpi/:unscaled,/usr/share/fonts/X11/Type1,/usr/share/fonts/X11/100dpi,/usr/share/fonts/X11/75dpi,built-ins' \
    -Dsha1=libnettle -Ddocs=false -Ddevel-docs=false
  meson compile -C /xorg-build/xserver/build -j2
  meson test -C /xorg-build/xserver/build --print-errorlogs
  DESTDIR="$stage" meson install -C /xorg-build/xserver/build
fi
python3 "$scripts/package.py" "$profile" "$stage" "$out"
# The probe links against the rebuilt clients and is a fixture, not a new runtime package.
cc $CFLAGS $CPPFLAGS "$scripts/check-xorg.c" -o "$out/check-xorg" \
  -I"$stage/usr/include" -L"$stage/usr/lib/$triplet" $LDFLAGS -lX11 -lXi -lXpm -lXrender -lGL
strip --strip-unneeded "$out/check-xorg"
