"""Prepare the exact Debian source plus reviewed, bounded upstream backports."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

recipe = Path(__file__).resolve().parent
destination = Path(sys.argv[1]).resolve()
destination.mkdir(parents=True, exist_ok=False)
base = 'https://deb.debian.org/debian/pool/main/libx/libxml2/'
sources = [
    (base + 'libxml2_2.12.7+dfsg+really2.9.14-2.1+deb13u3.dsc', '04b1da890535b11e3db231f39114ee09e643badceff79441d749d0ca78efaaa5'),
    (base + 'libxml2_2.12.7+dfsg+really2.9.14.orig.tar.xz', '4fe913dec8b1ab89d13b489b419a8203176ea39e931eaa0d25b17eafb9c279e9'),
    (base + 'libxml2_2.12.7+dfsg+really2.9.14-2.1+deb13u3.debian.tar.xz', '3b6d265f482d6a8fbe3c056d2006fb3b563b4a838f7258b388ac5f0b29206921'),
    ('https://download.gnome.org/sources/libxml2/2.9/libxml2-2.9.14.tar.xz', '60d74a257d1ccec0475e749cba2f21559e48139efba6ff28224357c7c798dfee'),
    ('https://www.w3.org/XML/Test/xmlts20080827.tar.gz', '96151685cec997e1f9f3387e3626d61e6284d4d6e66e0e440c209286c03e9cc7'),
]
for url, digest in sources:
    data = urllib.request.urlopen(url, timeout=60).read()
    assert hashlib.sha256(data).hexdigest() == digest, url
    (destination / url.rsplit('/', 1)[1]).write_bytes(data)

subprocess.run(['dpkg-source', '--no-check', '-x', sources[0][0].rsplit('/', 1)[1], 'libxml2'], cwd=destination, check=True)
source = destination / 'libxml2'
patches = []
for line in (recipe / 'patches/SHA256SUMS').read_text().splitlines():
    digest, filename = line.split()
    patch = recipe / 'patches' / filename
    assert patch.parent == recipe / 'patches' and patch.suffix == '.patch'
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == digest, filename
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(patch)], cwd=source, check=True)
    patches.append({'name': filename, 'sha256': digest})

# Debian's dfsg archive omits fixtures. Restore only same-release tests, not code.
with tarfile.open(destination / 'libxml2-2.9.14.tar.xz') as archive:
    archive.extractall(destination / 'test-release', filter='data')
for directory in ['test', 'result']:
    shutil.copytree(destination / 'test-release/libxml2-2.9.14' / directory, source / directory, dirs_exist_ok=True)
with tarfile.open(destination / 'xmlts20080827.tar.gz') as archive:
    archive.extractall(source, filter='data')

changelog = source / 'debian/changelog'
entry = ('libxml2 (2.12.7+dfsg+really2.9.14-2.1+deb13u3+runtime20261025.1) unstable; urgency=medium\n\n'
         '  * Refresh upstream runtime fixes and exercise the complete release fixtures.\n\n'
         ' -- Runtime Maintainers <maintainers@example.invalid>  Sun, 25 Oct 2026 00:00:00 +0000\n\n')
changelog.write_text(entry + changelog.read_text())
(source / 'runtime-source.json').write_text(json.dumps({'sources': sources, 'patches': patches, 'signature_verified': False}, indent=2) + '\n')
docs = source / 'debian/libxml2.docs'
docs.write_text((docs.read_text() if docs.exists() else '') + '\nruntime-source.json\n')
print(source)
