#!/usr/bin/env python3
"""Schema-only remote backup followed by an offline disposable restore proof.
Private configuration contains literal libpq KEY=value lines, without shell expansion.
No credentials, connection details or database diagnostics are emitted.
"""
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

SCHEMA = "artefactv2"
ALLOWED = {"PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSSLROOTCERT"}

def configuration(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid():
        raise RuntimeError("Backup configuration must be a private regular file")
    result = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGCONNECT_TIMEOUT": "15"}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key not in ALLOWED or key in result or not value or "\x00" in value:
            raise RuntimeError("Invalid backup configuration")
        result[key] = value
    if not {"PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSSLROOTCERT"} <= result.keys():
        raise RuntimeError("Incomplete backup configuration")
    if result["PGSSLMODE"] != "verify-full":
        raise RuntimeError("Remote backup requires certificate and hostname verification")
    return result

def run(args, **options):
    try:
        subprocess.run(args, check=True, stderr=subprocess.DEVNULL, timeout=600, **options)
    except (subprocess.SubprocessError, OSError):
        raise RuntimeError("Schema backup or restore verification failed") from None

def backup(config, destination):
    environment = configuration(config)
    try:
        version = subprocess.run(["pg_dump", "--version"], env=environment, capture_output=True, text=True, check=True, timeout=15).stdout
    except (subprocess.SubprocessError, OSError):
        raise RuntimeError("PostgreSQL 18 backup client is required") from None
    if not version.startswith("pg_dump (PostgreSQL) 18."):
        raise RuntimeError("PostgreSQL 18 backup client is required")
    partial = destination.with_name(destination.name + ".tmp")
    marker = destination.with_name(destination.name + ".verified")
    name = "pagegi-backup-proof-" + str(uuid.uuid4())
    if destination.exists() or marker.exists():
        raise RuntimeError("Backup destination already exists")
    created = False
    try:
        with partial.open("xb") as output:
            partial.chmod(0o600)
            run(["pg_dump", "--format=custom", "--schema=" + SCHEMA, "--schema=artefactv2_migration", "--strict-names", "--no-owner", "--no-privileges"], env=environment, stdout=output)
        # Start only a disposable offline verifier. It has no host mounts, database
        # credentials or published ports; all data is in bounded temporary memory.
        proof = """set -eu
cat > /tmp/archive.dump
initdb -D /tmp/data -A trust --no-locale >/dev/null
pg_ctl -D /tmp/data -o \"-k /tmp -c listen_addresses=''\" -w start >/dev/null
createdb -h /tmp recovery
pg_restore -h /tmp --dbname=recovery --exit-on-error --no-owner --no-privileges /tmp/archive.dump
pg_ctl -D /tmp/data -m immediate -w stop >/dev/null
"""
        created = True
        with partial.open("rb") as source:
            run(["docker", "run", "--name", name, "--label", "pagegi.backup-proof=1", "--network=none", "--read-only", "--memory=1g", "--memory-swap=1g", "--cpus=1", "--pids-limit=64", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=postgres", "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m,uid=999,gid=999", "-i", "--entrypoint", "sh", "postgres:18-bookworm", "-c", proof], stdin=source, stdout=subprocess.DEVNULL)
        # Verified removal is part of success, including an unsuccessful restore.
        run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL)
        created = False
        partial.rename(destination)
        with marker.open("x") as verified:
            verified.write("offline restore completed\n")
        marker.chmod(0o600)
    finally:
        partial.unlink(missing_ok=True)
        if created:
            run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL)

if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise RuntimeError("Expected private configuration and backup destination")
        backup(Path(sys.argv[1]), Path(sys.argv[2]))
    except (RuntimeError, OSError) as error:
        # OSError can include private paths; emit only fixed diagnostics.
        print(str(error) if isinstance(error, RuntimeError) else "Schema backup failed", file=sys.stderr)
        sys.exit(1)
