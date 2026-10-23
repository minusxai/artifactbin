#!/usr/bin/env python3
"""Root-approved, one-rollout reuse of an existing offline-restored backup."""
from __future__ import annotations
from pathlib import Path
from typing import TypedDict
import hashlib
import json
import os
import re
import stat
import sys
import time
from urllib.parse import unquote, urlsplit

SCHEMA_FILES = (
    'src/schema.sql', 'src/backend/af-schema.sql', 'src/datasets/schema.sql',
    'src/persistence/bootstrap.js', 'src/persistence/schema.ts',
    'src/persistence/schema-contracts.ts', 'src/persistence/sql.ts',
    'src/persistence/sql-contracts.ts', 'src/persistence/sql-deadline.ts',
    'src/database.js', 'src/server-main.js', 'package.json', 'package-lock.json',
    'Dockerfile', 'deploy/compose.artefactv2.yaml',
)

class ReuseApproval(TypedDict):
    schemaVersion: int
    currentRevision: str
    targetRevision: str
    backupName: str
    archiveSha256: str
    markerSha256: str
    destinationSha256: str
    productionConfigurationSha256: str
    verifiedAt: int
    expiresAt: int
    acknowledgeRecoveryPointAtBackupTime: bool
    reviewedCodeOnlyChange: bool


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def private_file(path: Path, uid: int) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise ValueError('Expected private owner-controlled regular file')


def literal_config(path: Path) -> dict[str, str]:
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in result or not value or '\x00' in value:
            raise ValueError('Invalid literal configuration')
        result[key] = value
    return result


def destination_identity(root: Path, uid: int) -> str:
    backup = root / '.env.backup'
    production = root / '.env.production'
    private_file(backup, uid)
    private_file(production, uid)
    source = literal_config(backup)
    target = literal_config(production)
    parsed = urlsplit(target['PAGEGI_DATABASE_URL'])
    identity = [source['PGHOST'], int(source.get('PGPORT', '5432')), source['PGDATABASE']]
    if source.get('PGSSLMODE') != 'verify-full' or parsed.scheme not in ('postgres', 'postgresql'):
        raise ValueError('Invalid database identity')
    if identity != [parsed.hostname, parsed.port or 5432, unquote(parsed.path.lstrip('/'))]:
        raise ValueError('Backup and application destinations differ')
    return hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()


def validate_reuse(root: Path, target: str, current: str, *, now: int, uid: int = 0) -> Path:
    """Validate before consuming approval; caller holds the receiver deploy lock."""
    control = root / 'reuse-backup.json'
    private_file(control, uid)
    approval: ReuseApproval = json.loads(control.read_text())
    if set(approval) != set(ReuseApproval.__annotations__):
        raise ValueError('Unexpected backup reuse fields')
    if (type(approval['schemaVersion']) is not int or approval['schemaVersion'] != 1 or not re.fullmatch('[0-9a-f]{40}', target)
            or not re.fullmatch('[0-9a-f]{40}', current)
            or approval['targetRevision'] != target or approval['currentRevision'] != current
            or target == current or approval['reviewedCodeOnlyChange'] is not True
            or approval['acknowledgeRecoveryPointAtBackupTime'] is not True):
        raise ValueError('Backup reuse revision or review mismatch')
    verified = approval['verifiedAt']
    expires = approval['expiresAt']
    if (type(verified) is not int or type(expires) is not int
            or not verified <= now <= expires or expires - verified > 3600):
        raise ValueError('Backup reuse approval expired or exceeds one hour')
    for field in ('archiveSha256', 'markerSha256', 'destinationSha256', 'productionConfigurationSha256'):
        if not isinstance(approval[field], str) or not re.fullmatch('[0-9a-f]{64}', approval[field]):
            raise ValueError('Invalid backup reuse digest')
    name = approval['backupName']
    if not isinstance(name, str) or not re.fullmatch('[0-9]{19}\.dump', name):
        raise ValueError('Invalid receiver backup name')
    archive = root / 'backups' / name
    marker = archive.with_name(name + '.verified')
    private_file(archive, uid)
    private_file(marker, uid)
    # The approval time cannot make an old archive appear newly verified.
    if not verified - 60 <= int(marker.stat().st_mtime) <= verified + 60:
        raise ValueError('Backup verification time mismatch')
    proof = json.loads(marker.read_text())
    if (proof.get('verification') != 'offline restore completed'
            or proof.get('archiveBytes') != archive.stat().st_size
            or digest(marker) != approval['markerSha256']
            or digest(archive) != approval['archiveSha256']):
        raise ValueError('Backup restore proof or archive mismatch')
    if (destination_identity(root, uid) != approval['destinationSha256']
            or digest(root / '.env.production') != approval['productionConfigurationSha256']):
        raise ValueError('Backup reuse destination mismatch')
    for name in SCHEMA_FILES:
        old = root / 'releases' / current / name
        new = root / 'releases' / target / name
        if old.is_symlink() or new.is_symlink() or not old.is_file() or not new.is_file() or digest(old) != digest(new):
            raise ValueError('Startup schema closure changed')
    return archive


def consume_reuse(root: Path, target: str, current: str, *, now: int, uid: int = 0) -> None:
    archive = validate_reuse(root, target, current, now=now, uid=uid)
    # Preserve the approved recovery point through post-rollout retention. Consume
    # the control before rollout, including failed rollout: reuse is never implicit.
    protection = archive.with_name(archive.name + '.protected')
    if protection.exists() or protection.is_symlink():
        private_file(protection, uid)
    else:
        descriptor = os.open(protection, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
    (root / 'reuse-backup.json').unlink()
    print('Reusing explicitly approved offline-restored backup; recovery point remains backup time')


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) != 4:
        raise ValueError('Root receiver invocation required')
    consume_reuse(Path(sys.argv[1]), sys.argv[2], sys.argv[3], now=int(time.time()))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Verified backup reuse refused', file=sys.stderr)
        sys.exit(1)
