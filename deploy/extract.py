"""Extract a Git archive without links, devices, or paths outside the release."""
import sys
import tarfile
from pathlib import PurePosixPath

with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    if sum(m.size for m in members) > 50 * 1024 * 1024:
        raise ValueError('Release exceeds 50 MB')
    for member in members:
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise ValueError('Unsafe archive entry')
        if member.name in ('.env.production', 'data') or member.name.startswith('data/'):
            raise ValueError('Runtime data must not be in a release')
    archive.extractall(sys.argv[2], members=members, filter='data')
