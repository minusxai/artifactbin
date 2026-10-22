#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if [[ $# != 1 || ! $1 =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Expected: deploy <commit SHA>' >&2
  exit 2
fi
revision=${BASH_REMATCH[1]}
root=/opt/artefactv2
# Compose execution must match the host Docker socket group.
export DOCKER_GID="$(stat -c %g /var/run/docker.sock)"
mkdir -p "$root/releases" "$root/backups"
# Only the trusted application writes mutation objects; imported source stores stay read-only.
install -d -o 1000 -g 1000 -m 0700 "$root/dataset-mutations"
# Dataset image outputs are private app-owned storage, separate from imported objects.
install -d -o 1000 -g 1000 -m 0700 "$root/dataset-attachments"
# The app reads this private persistent object mount as UID1000; deployments never replace its contents.
install -d -o 1000 -g 1000 -m 0700 "$root/datasets"
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
  python3 /usr/local/lib/artefactv2/extract.py "$archive" "$staging"
  mv "$staging" "$release"
fi
image="artefactv2:$revision"
docker build --label "org.opencontainers.image.revision=$revision" -t "$image" "$release"
# The sandbox image the execution service runs backend files on: the same revision as the app.
backend_image="artefactv2-backend:$revision"
docker build -t "$backend_image" "$release/src/backend/container"
image_processor_image="artefactv2-image-processor:$revision"
docker build -f "$release/src/media/image-processing/container/Dockerfile" -t "$image_processor_image" "$release"
dataset_sql_image="artefactv2-dataset-sql:$revision"
docker build -f "$release/src/datasets/sql/container/Dockerfile" -t "$dataset_sql_image" "$release"
# Capture the last working composition before replacing it. The lock covers this snapshot and rollout.
previous=$(cat "$root/current-image" 2>/dev/null || printf 'artefactv2:local')
previous_backend=$(cat "$root/current-backend-image" 2>/dev/null || printf 'artefactv2-backend:local')
previous_image_processor=$(cat "$root/current-image-processor-image" 2>/dev/null || printf 'artefactv2-image-processor:local')
previous_dataset_sql=$(cat "$root/current-dataset-sql-image" 2>/dev/null || printf 'artefactv2-dataset-sql:local')
previous_compose=$(mktemp "$root/.compose-before-rollout-XXXXXX")
had_previous_compose=false
if [[ -f "$root/compose.yaml" ]]; then
  cp -p "$root/compose.yaml" "$previous_compose"
  had_previous_compose=true
fi
compose=(docker compose --project-name artefactv2 --project-directory "$root" -f "$root/compose.yaml")
rollback_rollout() {
  status=$?
  trap - ERR
  # Capture the failed containers before Compose replaces them; private evidence never enters CI output.
  python3 "$release/deploy/capture-rollout-failure.py" "$root" "$revision" "$status" "${compose[@]}" >/dev/null 2>&1 || echo 'Private rollout diagnostics could not be collected' >&2
  if [[ "$had_previous_compose" == true ]]; then
    echo 'Deployment failed; restoring previous composition and images' >&2
    cp -p "$previous_compose" "$root/compose.yaml.rollback"
    mv "$root/compose.yaml.rollback" "$root/compose.yaml"
    export PAGEGI_IMAGE="$previous" PAGEGI_BACKEND_IMAGE="$previous_backend" PAGEGI_IMAGE_PROCESSOR_IMAGE="$previous_image_processor" PAGEGI_DATASET_SQL_IMAGE="$previous_dataset_sql"
    "${compose[@]}" up -d --no-build --wait --wait-timeout 120 || echo 'Previous rollout failed to recover; operator intervention required' >&2
  else
    echo 'Initial deployment failed; no previous composition exists' >&2
    rm -f "$root/compose.yaml"
  fi
  rm -f "$previous_compose"
  exit "$status"
}
trap rollback_rollout ERR
# The composition is the release's, never a host-edited copy.
cp "$release/deploy/compose.artefactv2.yaml" "$root/compose.yaml.tmp"
mv "$root/compose.yaml.tmp" "$root/compose.yaml"
# Backend sandboxes run on the Docker bridge `artefactv2-sb` (network artefactv2-sandbox, created by the
# execution service; src/backend/README.md) and may reach public addresses only. workerd enforces
# that for lambda code; these rules are the kernel backstop: from that bridge, nothing to the host
# itself and nothing to private, loopback, link-local or reserved ranges, except DNS to the host's
# resolvers. IPv4 only: the sandbox bridge is created without IPv6. The rules live in a standalone
# script that the unit below reapplies at boot and whenever Docker (re)starts; every deployment
# rewrites both and also runs the script directly. Idempotent.
egress_script=/usr/local/sbin/artefactv2-sandbox-egress
egress_unit=/etc/systemd/system/artefactv2-sandbox-egress.service
egress_tmp=$(mktemp)
cat > "$egress_tmp" <<'EGRESS'
#!/bin/sh
# Installed by deploy/receive.sh; applies the artefactv2-sb egress rules. Idempotent.
set -eu
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
chain=ARTEFACTV2-SANDBOX
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
iptables -C DOCKER-USER -i artefactv2-sb -j "$chain" 2>/dev/null || iptables -I DOCKER-USER -i artefactv2-sb -j "$chain"
iptables -C INPUT -i artefactv2-sb -j DROP 2>/dev/null || iptables -I INPUT -i artefactv2-sb -j DROP
EGRESS
install -o root -g root -m 0755 "$egress_tmp" "$egress_script"
# PartOf + WantedBy=docker.service: stopping or restarting Docker stops or restarts this unit,
# and starting Docker starts it again, so the rules are reapplied after Docker sets up its chains.
cat > "$egress_tmp" <<'UNIT'
[Unit]
Description=Pagegi sandbox egress firewall (artefactv2-sb)
After=docker.service network-online.target
Wants=network-online.target
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/artefactv2-sandbox-egress

[Install]
WantedBy=multi-user.target docker.service
UNIT
install -o root -g root -m 0644 "$egress_tmp" "$egress_unit"
rm -f "$egress_tmp"
systemctl daemon-reload && systemctl enable --now artefactv2-sandbox-egress.service
"$egress_script"
# The shared remote database is provisioned separately; never start or alter a local database.
# The backup role reads only this deployment's runtime and archive schemas.
backup="$root/backups/$(date +%s%N).dump"
python3 "$release/deploy/backup-schema.py" "$root/.env.backup" "$backup"
export PAGEGI_IMAGE="$image" PAGEGI_BACKEND_IMAGE="$backend_image" PAGEGI_IMAGE_PROCESSOR_IMAGE="$image_processor_image" PAGEGI_DATASET_SQL_IMAGE="$dataset_sql_image"
# Both execution and application healthchecks must pass inside this rollback boundary.
"${compose[@]}" up -d --no-build --wait --wait-timeout 120
trap - ERR
if [[ "$had_previous_compose" == true ]]; then
  mv "$previous_compose" "$root/previous-compose.yaml"
else
  rm -f "$previous_compose"
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
printf '%s\n' "$previous_dataset_sql" > "$root/previous-dataset-sql-image"
printf '%s\n' "$dataset_sql_image" > "$root/current-dataset-sql-image.tmp"
mv "$root/current-dataset-sql-image.tmp" "$root/current-dataset-sql-image"
# Keep ordinary docker compose operations on the successful release too.
printf 'PAGEGI_IMAGE=%s\nPAGEGI_BACKEND_IMAGE=%s\nPAGEGI_IMAGE_PROCESSOR_IMAGE=%s\nPAGEGI_DATASET_SQL_IMAGE=%s\n' "$image" "$backend_image" "$image_processor_image" "$dataset_sql_image" > "$root/.env.tmp"
mv "$root/.env.tmp" "$root/.env"
# Only this receiver's timestamp namespace is eligible; named/protected backups survive.
python3 "$release/deploy/backup-retention.py" "$root/backups" --apply
python3 - "$root" <<'PY'
from pathlib import Path
import shutil, sys
root=Path(sys.argv[1])
for p in sorted((root/'releases').iterdir(),key=lambda p:p.stat().st_mtime,reverse=True)[5:]:
    if p.is_dir() and not p.name.startswith('.'): shutil.rmtree(p)
PY
printf 'Deployed %s\n' "$revision"
