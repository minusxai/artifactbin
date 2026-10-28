#!/usr/bin/env python3
"""Keep the captured Xvfb authentication surface across build-system defaults.

os/auth.c always registers MIT-MAGIC-COOKIE-1, and registers SUN-DES-1 only
under SECURE_RPC. The latter is optional in configure but enabled by Meson.
Inspect the frozen executable, never builder-installed dependencies.
"""
import sys
from pathlib import Path


def secure_rpc(path):
    payload = Path(path).read_bytes()
    if not payload.startswith(b'\x7fELF') or b'MIT-MAGIC-COOKIE-1\x00' not in payload:
        raise ValueError('Expected captured Xvfb ELF authentication table')
    return b'SUN-DES-1\x00' in payload


if __name__ == '__main__':
    baseline = secure_rpc(sys.argv[1])
    if len(sys.argv) == 3 and secure_rpc(sys.argv[2]) != baseline:
        raise ValueError('Rebuilt Xvfb authentication profile differs from captured baseline')
    print('true' if baseline else 'false')
