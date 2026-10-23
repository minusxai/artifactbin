#!/usr/bin/env python3
"""Schema-only remote backup followed by an offline disposable restore proof.
Private configuration contains literal libpq KEY=value lines, without shell expansion.
No credentials, connection details or database diagnostics are emitted.
"""
import os
import json
import re
import resource
import shutil
import signal
import time
from pathlib import Path
import stat
import subprocess
import sys
import uuid
from typing import NamedTuple, TypedDict

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

# Capacity contract: estimates include archive bytes retained both on the host and
# in the restore volume, database/index/WAL expansion, and an untouched free reserve.
GIB = 1024 ** 3
RESERVE_BYTES = 8 * GIB
MAX_ARCHIVE_BYTES = 32 * GIB
MAX_VOLUME_BYTES = 64 * GIB
JOB_SECONDS = 1800
POLL_SECONDS = 2

class RestoreResources(NamedTuple):
    jobs: int
    cpus: int
    memory_mib: int

RESTORE_RESOURCES = RestoreResources(jobs=4, cpus=4, memory_mib=2048)

class BackupStageSeconds(TypedDict):
    prepare: float
    dump: float
    restore: float
    cleanup: float
    total: float

def capacity(source_bytes):
    if not isinstance(source_bytes, int) or source_bytes < 0:
        raise RuntimeError("Invalid measured schema size")
    archive = max(GIB, source_bytes * 2 + GIB)
    volume = max(4 * GIB, source_bytes * 3 + archive + GIB)
    if archive > MAX_ARCHIVE_BYTES:
        raise RuntimeError("Measured backup exceeds the reviewed disk budget")
    return archive, min(volume, MAX_VOLUME_BYTES)

def restore_capacity(source_bytes, archive_bytes, free_bytes):
    """Bound the verifier by measured remaining capacity, including its archive copy.

    The desired expansion allowance is three source sizes plus archive and 1GiB.
    A smaller available budget is safe because the existing live monitor fails
    closed before publishing a verified recovery point. Admission still requires
    source size, the measured archive copy and 1GiB of database/WAL headroom.
    """
    if any(not isinstance(value, int) or value < 0
           for value in (source_bytes, archive_bytes, free_bytes)):
        raise RuntimeError("Invalid measured backup capacity")
    minimum = source_bytes + archive_bytes + GIB
    desired = max(4 * GIB, source_bytes * 3 + archive_bytes + GIB)
    budget = min(desired, MAX_VOLUME_BYTES, free_bytes - RESERVE_BYTES)
    if budget < minimum:
        raise RuntimeError("Insufficient measured disk space for restore proof")
    return budget

def command(args, *, timeout=30, **options):
    try:
        return subprocess.run(args, check=True, stderr=subprocess.PIPE,
                              timeout=timeout, **options)
    except (subprocess.SubprocessError, OSError):
        raise RuntimeError("Schema backup or restore verification failed") from None

def capture(args, **options):
    return command(args, stdout=subprocess.PIPE, **options).stdout

def absent(kind, name):
    try:
        result = subprocess.run(["docker", *kind, "inspect", name], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=15)
    except (subprocess.SubprocessError, OSError):
        return False
    return result.returncode > 0 and bool(re.search(rb"No such (?:container|object|volume)", result.stderr, re.I))

def owned(kind, name, token):
    try:
        rows = json.loads(capture(["docker", *kind, "inspect", name]))
        labels = rows[0].get("Labels", {}) if kind else rows[0].get("Config", {}).get("Labels", {})
        return len(rows) == 1 and isinstance(labels, dict) and labels.get("pagegi.backup-proof-job") == token
    except (RuntimeError, ValueError, IndexError, TypeError):
        return False

class VolumeProof:
    def __init__(self):
        self.token = str(uuid.uuid4())
        self.name = "pagegi-backup-proof-" + self.token
        self.probe = self.name + "-probe"
        self.volume = self.name + "-data"
        self.volume_attempted = False
        self.containers = []

    def labels(self):
        return ["--label", "pagegi.backup-proof=1", "--label", "pagegi.backup-proof-job=" + self.token]

    def mount(self, readonly=False):
        return ["--mount", "type=volume,source=" + self.volume + ",target=/proof,volume-nocopy" + (",readonly" if readonly else "")]

    def create(self):
        self.volume_attempted = True
        capture(["docker", "volume", "create", *self.labels(), self.volume])
        # A fresh managed volume starts root-owned. This fixed setup command has
        # only CHOWN and no credentials, host paths, network or published ports.
        self.containers.append(self.probe)
        output = capture(["docker", "run", "--name", self.probe, *self.labels(), "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=CHOWN", *self.mount(), "--entrypoint", "sh", "postgres:18-bookworm", "-c", "chown 999:999 /proof; df -Pk /proof | awk 'NR==2{print $4}'"])
        free = integer(output) * 1024
        self.remove_container(self.probe)
        self.containers.remove(self.probe)
        return free

    def measure_bytes(self, usage=False):
        self.containers.append(self.probe)
        output = capture(["docker", "run", "--name", self.probe, *self.labels(),
                          "--network=none", "--read-only", "--cap-drop=ALL", "--user=postgres",
                          *self.mount(readonly=True), "--entrypoint", "sh",
                          "postgres:18-bookworm", "-c",
                          ("du -sk /proof | awk '{print $1}'" if usage else "df -Pk /proof | awk 'NR==2{print $4}'")])
        self.remove_container(self.probe)
        self.containers.remove(self.probe)
        return integer(output) * 1024

    def remove_container(self, name):
        if absent([], name):
            return
        if not owned([], name, self.token):
            raise RuntimeError("Backup verifier cleanup could not prove ownership")
        try:
            command(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL)
        except RuntimeError:
            pass
        if not absent([], name):
            raise RuntimeError("Backup verifier cleanup could not prove absence")

    def close(self):
        for name in reversed(self.containers):
            self.remove_container(name)
        self.containers.clear()
        if self.volume_attempted:
            if not absent(["volume"], self.volume):
                if not owned(["volume"], self.volume, self.token):
                    raise RuntimeError("Backup volume cleanup could not prove ownership")
                try:
                    command(["docker", "volume", "rm", self.volume], stdout=subprocess.DEVNULL)
                except RuntimeError:
                    pass
                if not absent(["volume"], self.volume):
                    raise RuntimeError("Backup volume cleanup could not prove absence")
            self.volume_attempted = False

    def restore(self, archive, maximum, host_directory, deadline):
        proof = """set -eu
cat > /proof/archive.dump
initdb -D /proof/data -A trust --no-locale >/dev/null
pg_ctl -D /proof/data -o "-k /tmp -c listen_addresses='' -c shared_buffers=64MB -c max_wal_size=256MB -c maintenance_work_mem=64MB" -w start >/dev/null
createdb -h /tmp recovery
pg_restore -h /tmp --dbname=recovery --jobs=@JOBS@ --exit-on-error --no-owner --no-privileges /proof/archive.dump
pg_ctl -D /proof/data -m immediate -w stop >/dev/null
used=$(du -sk /proof | awk '{print $1}')
free=$(df -Pk /proof | awk 'NR==2{print $4}')
case "$used:$free" in *[!0-9:]*|:*) exit 1;; esac
[ "$used" -le "$1" ] && [ "$free" -ge "$2" ]
"""
        proof = proof.replace("@JOBS@", str(RESTORE_RESOURCES.jobs))
        self.containers.append(self.name)
        args = ["docker", "run", "--name", self.name, *self.labels(), "--network=none", "--read-only", "--memory", str(RESTORE_RESOURCES.memory_mib) + "m", "--memory-swap", str(RESTORE_RESOURCES.memory_mib) + "m", "--cpus", str(RESTORE_RESOURCES.cpus), "--pids-limit=64", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=postgres", "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m,uid=999,gid=999", *self.mount(), "-i", "--entrypoint", "sh", "postgres:18-bookworm", "-c", proof, "proof", str(maximum // 1024), str((RESERVE_BYTES + 1023) // 1024)]
        with archive.open("rb") as source:
            try:
                process = subprocess.Popen(args, stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                raise RuntimeError("Backup verifier could not start") from None
            started = time.monotonic()
            try:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise RuntimeError("Backup verification deadline exceeded")
                    try:
                        code = process.wait(timeout=min(POLL_SECONDS, remaining))
                        if code != 0:
                            raise RuntimeError("Schema restore verification failed")
                        if shutil.disk_usage(host_directory).free < RESERVE_BYTES:
                            raise RuntimeError("Backup free-space reserve reached")
                        break
                    except subprocess.TimeoutExpired:
                        if shutil.disk_usage(host_directory).free < RESERVE_BYTES:
                            raise RuntimeError("Backup free-space reserve reached")
                        # Commands execute fixed image binaries, never restored code.
                        measured = subprocess.run(["docker", "exec", self.name, "sh", "-c", "du -sk /proof | awk '{print $1}'; df -Pk /proof | awk 'NR==2{print $4}'"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
                        if measured.returncode != 0:
                            if process.poll() is not None:
                                continue
                            if time.monotonic() - started < 15:
                                continue
                            raise RuntimeError("Backup disk usage could not be measured")
                        values = measured.stdout.splitlines()
                        if len(values) != 2 or integer(values[0]) * 1024 > maximum or integer(values[1]) * 1024 < RESERVE_BYTES:
                            raise RuntimeError("Backup restore disk budget exceeded")
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=15)

def dump_archive(environment, output, archive_limit, directory, deadline):
    def file_limit():
        resource.setrlimit(resource.RLIMIT_FSIZE, (archive_limit, archive_limit))
    args = ["pg_dump", "--format=custom", "--schema=" + SCHEMA,
            "--schema=artefactv2_migration", "--strict-names", "--no-owner", "--no-privileges"]
    try:
        process = subprocess.Popen(args, env=environment, stdout=output,
                                   stderr=subprocess.DEVNULL, preexec_fn=file_limit)
    except OSError:
        raise RuntimeError("Backup archive could not start") from None
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("Backup archive deadline exceeded")
            if shutil.disk_usage(directory).free < RESERVE_BYTES:
                raise RuntimeError("Backup free-space reserve reached")
            try:
                code = process.wait(timeout=min(POLL_SECONDS, remaining))
                if code != 0:
                    raise RuntimeError("Schema archive failed")
                if shutil.disk_usage(directory).free < RESERVE_BYTES:
                    raise RuntimeError("Backup free-space reserve reached")
                return
            except subprocess.TimeoutExpired:
                continue
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=15)

def integer(value):
    if not re.fullmatch(rb"[0-9]+", value.strip()):
        raise RuntimeError("Invalid measured backup capacity")
    return int(value.strip())

def backup(config, destination):
    started = time.monotonic()
    environment = configuration(config)
    version = capture(["pg_dump", "--version"], env=environment, timeout=15)
    if not version.startswith(b"pg_dump (PostgreSQL) 18."):
        raise RuntimeError("PostgreSQL 18 backup client is required")
    size_sql = "SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('artefactv2','artefactv2_migration') AND c.relkind IN ('r','m');"
    source_bytes = integer(capture(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", size_sql], env=environment, timeout=30))
    archive_limit, _ = capacity(source_bytes)
    partial = destination.with_name(destination.name + ".tmp")
    marker = destination.with_name(destination.name + ".verified")
    if destination.exists() or marker.exists():
        raise RuntimeError("Backup destination already exists")
    archive_limit = min(archive_limit, shutil.disk_usage(destination.parent).free - RESERVE_BYTES)
    if archive_limit < GIB:
        raise RuntimeError("Insufficient measured disk space for archive")
    proof = VolumeProof()
    deadline = time.monotonic() + JOB_SECONDS
    try:
        if proof.create() < RESERVE_BYTES:
            raise RuntimeError("Insufficient Docker volume filesystem capacity")
        dump_started = time.monotonic()
        with partial.open("xb") as output:
            partial.chmod(0o600)
            dump_archive(environment, output, archive_limit, destination.parent, deadline)
        dump_finished = time.monotonic()
        if partial.stat().st_size > archive_limit:
            raise RuntimeError("Backup archive disk budget exceeded")
        archive_bytes = partial.stat().st_size
        free_bytes = min(shutil.disk_usage(destination.parent).free,
                         proof.measure_bytes())
        volume_limit = restore_capacity(source_bytes, archive_bytes, free_bytes)
        proof.restore(partial, volume_limit, destination.parent, deadline)
        restored_bytes = proof.measure_bytes(usage=True)
        if restored_bytes > volume_limit:
            raise RuntimeError("Backup restore disk budget exceeded")
        restore_finished = time.monotonic()
        proof.close()
        cleanup_finished = time.monotonic()
        stage_seconds: BackupStageSeconds = {
            "prepare": round(dump_started - started, 3),
            "dump": round(dump_finished - dump_started, 3),
            "restore": round(restore_finished - dump_finished, 3),
            "cleanup": round(cleanup_finished - restore_finished, 3),
            "total": round(cleanup_finished - started, 3),
        }
        partial.rename(destination)
        with marker.open("x") as verified:
            verified.write(json.dumps({"verification":"offline restore completed", "stageSeconds":stage_seconds, "sourceBytes":source_bytes, "archiveBytes":destination.stat().st_size, "restoredBytes":restored_bytes, "archiveLimit":archive_limit, "restoreVolumeLimit":volume_limit, "reserveBytes":RESERVE_BYTES}) + "\n")
        marker.chmod(0o600)
    finally:
        partial.unlink(missing_ok=True)
        proof.close()

if __name__ == "__main__":
    def interrupted(_signal, _frame):
        raise RuntimeError("Backup interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if len(sys.argv) != 3:
            raise RuntimeError("Expected private configuration and backup destination")
        backup(Path(sys.argv[1]), Path(sys.argv[2]))
    except (RuntimeError, OSError, subprocess.SubprocessError):
        print("Schema backup or restore verification failed; no verified recovery point was published", file=sys.stderr)
        sys.exit(1)
