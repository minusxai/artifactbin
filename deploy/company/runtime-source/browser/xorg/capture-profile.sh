#!/bin/sh
# Run on the untouched final runtime base, before installing build dependencies.
set -eu
profile=${1:-/xorg-profile}
mkdir -p "$profile"
dpkg-query -W -f='${binary:Package}\t${source:Package}\t${db:Status-Status}\n' > "$profile/packages.tsv"
tab=$(printf '\t')
while IFS="$tab" read -r binary source status; do
  [ "$status" = installed ] || continue
  case "$source" in libx11|libxi|libxpm|libxrender|xorg-server|x11-xkb-utils) ;; *) continue ;; esac
  package=${binary%%:*}
  case "$source:$package" in xorg-server:xvfb|xorg-server:xserver-common) ;; xorg-server:*) echo "Unsupported installed X server package: $package" >&2; exit 1 ;; esac
  destination=$profile/$package
  mkdir -p "$destination/files" "$destination/control-files"
  printf '%s\n' "$source" > "$destination/source"
  dpkg-query -s "$binary" > "$destination/control"
  dpkg-query -L "$binary" > "$destination/inventory"
  while IFS= read -r file; do
    if [ -f "$file" ] || [ -L "$file" ]; then cp -a --parents "$file" "$destination/files"; fi
  done < "$destination/inventory"
  arch=$(dpkg-query -W -f='${Architecture}' "$binary")
  for suffix in preinst postinst prerm postrm triggers conffiles; do
    for file in /var/lib/dpkg/info/"$package"."$suffix" /var/lib/dpkg/info/"$package:$arch"."$suffix"; do
      if [ -f "$file" ]; then cp -a "$file" "$destination/control-files/$suffix"; break; fi
    done
  done
done < "$profile/packages.tsv"
