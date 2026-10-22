#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if [[ $# != 1 || ! $1 =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Expected: deploy <commit SHA>' >&2
  exit 2
fi
revision=${BASH_REMATCH[1]}
root=/opt/pagegi
mkdir -p "$root/releases" "$root/backups"
exec 9>"$root/deploy.lock"
flock -w 300 9
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
# A bounded stream prevents a deployment credential filling the host disk.
head -c 52428801 > "$archive"
[[ $(stat -c %s "$archive") -le 52428800 ]] || { echo 'Archive too large' >&2; exit 2; }
release="$root/releases/$revision"
if [[ ! -d $release ]]; then
  staging=$(mktemp -d "$root/releases/.incoming-XXXXXX")
  trap 'rm -f "$archive"; rm -rf "${staging:-}"' EXIT
  python3 /usr/local/lib/pagegi/extract.py "$archive" "$staging"
  mv "$staging" "$release"
fi
image="pagegi:$revision"
docker build --label "org.opencontainers.image.revision=$revision" -t "$image" "$release"
# The sandbox image the execution service runs backend files on: the same revision as the app.
backend_image="pagegi-backend:$revision"
docker build -t "$backend_image" "$release/src/backend/container"
image_processor_image="pagegi-image-processor:$revision"
docker build -f "$release/src/media/image-processing/container/Dockerfile" -t "$image_processor_image" "$release"
# The composition is the release's, never a host-edited copy.
cp "$release/compose.yaml" "$root/compose.yaml.tmp"
mv "$root/compose.yaml.tmp" "$root/compose.yaml"
previous=$(cat "$root/current-image" 2>/dev/null || printf 'pagegi:local')
previous_backend=$(cat "$root/current-backend-image" 2>/dev/null || printf 'pagegi-backend:local')
previous_image_processor=$(cat "$root/current-image-processor-image" 2>/dev/null || printf 'pagegi-image-processor:local')
compose=(docker compose --project-name pagegi --project-directory "$root" -f "$root/compose.yaml")
# Backend sandboxes run on the Docker bridge `pagegi-sbx` (network pagegi-sandbox, created by the
# execution service; src/backend/README.md) and may reach public addresses only. workerd enforces
# that for lambda code; these rules are the kernel backstop: from that bridge, nothing to the host
# itself and nothing to private, loopback, link-local or reserved ranges, except DNS to the host's
# resolvers. IPv4 only: the sandbox bridge is created without IPv6. The rules live in a standalone
# script that the unit below reapplies at boot and whenever Docker (re)starts; every deployment
# rewrites both and also runs the script directly. Idempotent.
egress_script=/usr/local/sbin/pagegi-sandbox-egress
egress_unit=/etc/systemd/system/pagegi-sandbox-egress.service
egress_tmp=$(mktemp)
cat > "$egress_tmp" <<'EGRESS'
#!/bin/sh
# Installed by deploy/receive.sh; applies the pagegi-sbx egress rules. Idempotent.
set -eu
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
chain=PAGEGI-SANDBOX
resolv=${PAGEGI_SANDBOX_RESOLV_CONF:-/etc/resolv.conf}
if [ -z "${PAGEGI_SANDBOX_RESOLV_CONF:-}" ] && [ -r /run/systemd/resolve/resolv.conf ]; then
  resolv=/run/systemd/resolve/resolv.conf
fi
iptables -N "$chain" 2>/dev/null || true
iptables -F "$chain"
for ns in $(awk '$1 == "nameserver" && $2 ~ /^[0-9.]+$/ && $2 !~ /^127\./ { print $2 }' "$resolv"); do
  iptables -A "$chain" -d "$ns" -p udp --dport 53 -j RETURN
  iptables -A "$chain" -d "$ns" -p tcp --dport 53 -j RETURN
done
for net in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4; do
  iptables -A "$chain" -d "$net" -j DROP
done
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -i pagegi-sbx -j "$chain" 2>/dev/null || iptables -I DOCKER-USER -i pagegi-sbx -j "$chain"
iptables -C INPUT -i pagegi-sbx -j DROP 2>/dev/null || iptables -I INPUT -i pagegi-sbx -j DROP
EGRESS
install -o root -g root -m 0755 "$egress_tmp" "$egress_script"
# PartOf + WantedBy=docker.service: stopping or restarting Docker stops or restarts this unit,
# and starting Docker starts it again, so the rules are reapplied after Docker sets up its chains.
cat > "$egress_tmp" <<'UNIT'
[Unit]
Description=Pagegi sandbox egress firewall (pagegi-sbx)
After=docker.service network-online.target
Wants=network-online.target
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/pagegi-sandbox-egress

[Install]
WantedBy=multi-user.target docker.service
UNIT
install -o root -g root -m 0644 "$egress_tmp" "$egress_unit"
rm -f "$egress_tmp"
systemctl daemon-reload && systemctl enable --now pagegi-sandbox-egress.service
"$egress_script"
"${compose[@]}" up -d --wait --wait-timeout 90 postgres
backup="$root/backups/$(date +%s%N).dump"
(umask 077; "${compose[@]}" exec -T postgres pg_dump -U pagegi -d pagegi -Fc > "$backup.tmp")
mv "$backup.tmp" "$backup"
export PAGEGI_IMAGE="$image" PAGEGI_BACKEND_IMAGE="$backend_image" PAGEGI_IMAGE_PROCESSOR_IMAGE="$image_processor_image"
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 120; then
  echo 'Deployment failed; restoring previous images' >&2
  export PAGEGI_IMAGE="$previous" PAGEGI_BACKEND_IMAGE="$previous_backend" PAGEGI_IMAGE_PROCESSOR_IMAGE="$previous_image_processor"
  "${compose[@]}" up -d --no-build --wait --wait-timeout 120
  exit 1
fi
printf '%s\n' "$previous" > "$root/previous-image"
printf '%s\n' "$previous_backend" > "$root/previous-backend-image"
printf '%s\n' "$image" > "$root/current-image.tmp"
mv "$root/current-image.tmp" "$root/current-image"
printf '%s\n' "$backend_image" > "$root/current-backend-image.tmp"
mv "$root/current-backend-image.tmp" "$root/current-backend-image"
printf '%s\n' "$previous_image_processor" > "$root/previous-image-processor-image"
printf '%s\n' "$image_processor_image" > "$root/current-image-processor-image.tmp"
mv "$root/current-image-processor-image.tmp" "$root/current-image-processor-image"
# Keep ordinary docker compose operations on the successful release too.
printf 'PAGEGI_IMAGE=%s\nPAGEGI_BACKEND_IMAGE=%s\nPAGEGI_IMAGE_PROCESSOR_IMAGE=%s\n' "$image" "$backend_image" "$image_processor_image" > "$root/.env.tmp"
mv "$root/.env.tmp" "$root/.env"
python3 - "$root" <<'PY'
from pathlib import Path
import shutil, sys
root=Path(sys.argv[1])
for p in sorted((root/'backups').glob('*.dump'),key=lambda p:p.stat().st_mtime,reverse=True)[7:]: p.unlink()
for p in sorted((root/'releases').iterdir(),key=lambda p:p.stat().st_mtime,reverse=True)[5:]:
    if p.is_dir() and not p.name.startswith('.'): shutil.rmtree(p)
PY
printf 'Deployed %s\n' "$revision"
