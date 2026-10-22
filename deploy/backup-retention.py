#!/usr/bin/env python3
"""Retain only receiver-owned timestamp backups; named recovery points are sacred."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import argparse
import json
import re
import stat

OWNED = re.compile(r"^[0-9]{19}\.dump$")

@dataclass(frozen=True)
class Backup:
    name: str
    size: int
    timestamp: int
    regular: bool = True
    protected: bool = False
    verified: bool = False

@dataclass(frozen=True)
class RetentionPlan:
    delete: tuple[str, ...]
    remaining_bytes: int
    remaining_count: int
    over_budget: bool


def plan_retention(backups: list[Backup], keep: int = 7,
                   max_bytes: int = 16 * 1024**3) -> RetentionPlan:
    """Pure policy. Never sacrifice two recent or two verified recovery points."""
    if keep < 2 or max_bytes < 0:
        raise ValueError("Invalid backup retention bounds")
    regular = [b for b in backups if b.regular]
    owned = sorted((b for b in regular if OWNED.fullmatch(b.name)),
                   key=lambda b: (b.timestamp, b.name), reverse=True)
    protected = {b.name for b in owned[:2]}
    protected.update(b.name for b in owned if b.protected)
    protected.update(b.name for b in [b for b in owned if b.verified][:2])
    remaining_bytes = sum(b.size for b in regular)
    remaining_count = len(owned)
    delete: list[str] = []
    for backup in reversed(owned):
        if remaining_count <= keep and remaining_bytes <= max_bytes:
            break
        if backup.name in protected:
            continue
        delete.append(backup.name)
        remaining_count -= 1
        remaining_bytes -= backup.size
    return RetentionPlan(tuple(delete), remaining_bytes, remaining_count,
                         remaining_bytes > max_bytes or remaining_count > keep)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--keep", type=int, default=7)
    parser.add_argument("--max-bytes", type=int, default=16 * 1024**3)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    backups = []
    for path in args.directory.iterdir():
        if not path.name.endswith('.dump'):
            continue
        info = path.lstat()
        backups.append(Backup(path.name, info.st_size,
            int(path.name[:-5]) if OWNED.fullmatch(path.name) else 0,
            stat.S_ISREG(info.st_mode),
            (path.with_name(path.name + '.protected').exists() or path.with_name(path.name + '.protected').is_symlink()),
            path.with_name(path.name + '.verified').exists()))
    plan = plan_retention(backups, args.keep, args.max_bytes)
    if args.apply:
        # The receiver holds its exclusive lock. Recheck file type and protection
        # immediately before unlink, even if an operator wrote a new marker.
        for name in plan.delete:
            path = args.directory / name
            if path.is_symlink() or not path.is_file() or path.with_name(name + '.protected').exists() or path.with_name(name + '.protected').is_symlink():
                continue
            path.unlink()
            path.with_name(name + '.verified').unlink(missing_ok=True)
    print(json.dumps({'eligibleDeletes': len(plan.delete), 'applied': args.apply,
                      'remainingBytes': plan.remaining_bytes,
                      'remainingOwnedCount': plan.remaining_count,
                      'overBudget': plan.over_budget}))
    # Protected recovery points are never deleted to satisfy a budget. Operators
    # must measure and resolve excess before the next deployment/import.

if __name__ == '__main__':
    main()
