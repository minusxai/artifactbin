"""Package only captured runtime interfaces; never infer inventory from build dependencies."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

profile, stage, out = map(Path, sys.argv[1:])
triplet = subprocess.check_output(['dpkg-architecture', '-qDEB_HOST_MULTIARCH'], text=True).strip()
receipts = json.loads(Path(__file__).with_name('source-receipts.json').read_text())
roots, metadata, versions, replacements = {}, {}, {}, {}


def fields(text):
    result = {}
    key = None
    for line in text.splitlines():
        if line.startswith((' ', '\t')) and key:
            result[key] += '\n' + line
        elif ': ' in line:
            key, value = line.split(': ', 1)
            result[key] = value
    return result


def normalize(path):
    return '/usr' + path if path.startswith(('/bin/', '/sbin/', '/lib/', '/lib64/')) else path


def copy(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink() or dest.exists():
        dest.unlink()
    shutil.copy2(src, dest, follow_symlinks=False)


def elf(path):
    return path.is_file() and not path.is_symlink() and path.open('rb').read(4) == b'\x7fELF'


def exports(path):
    output = subprocess.check_output(['objdump', '-T', str(path)], text=True)
    return {tuple(line.split()[-2:]) for line in output.splitlines()
            if len(line.split()) >= 7 and '*UND*' not in line and '*ABS*' not in line}


for captured in sorted(profile.iterdir()):
    if not captured.is_dir():
        continue
    package = captured.name
    original = fields((captured / 'control').read_text())
    source = (captured / 'source').read_text().strip()
    if package == 'xserver-common':
        # Debian's common files contain data/scripts, not the rebuilt server binary.
        # Retain its actual distro version; do not relabel unchanged payloads.
        continue
    receipt = receipts[source]
    epoch = original['Version'].split(':', 1)[0] + ':' if ':' in original['Version'] else ''
    version = (original['Version'] + '+xkbcomp1.5.0-1+runtime1' if source == 'x11-xkb-utils' else epoch + receipt['version'] + '-1+runtime1')
    versions[package] = version
    root = out / 'packages' / package
    root.mkdir(parents=True, exist_ok=True)
    changes = []
    retained_components = []
    family_names = set()
    inventory = (captured / 'inventory').read_text().splitlines()
    for oldpath in inventory:
        src = captured / 'files' / oldpath.lstrip('/')
        if not (src.is_file() or src.is_symlink()):
            continue
        installed = normalize(oldpath)
        dest = root / installed.lstrip('/')
        candidate = stage / installed.lstrip('/')
        if source == 'x11-xkb-utils' and installed not in (
                '/usr/bin/xkbcomp', '/usr/share/pkgconfig/xkbcomp.pc', '/usr/share/man/man1/xkbcomp.1.gz'):
            # Debian combines several independent upstream programs. This is an
            # explicitly versioned xkbcomp backport, not a fictitious whole-bundle
            # release. Retain all other original interfaces and exact code bytes.
            copy(src, dest)
            if elf(src):
                retained_components.append({'installed': installed, 'baseline_package_version': original['Version'], 'sha256': hashlib.sha256(src.read_bytes()).hexdigest()})
            continue
        family = re.match(r'(lib[^/]+\.so\.\d+)(?:\.\d+)*$', src.name)
        if family:
            family_names.add(family.group(1))
            continue
        # Public headers/static archives/pkg-config and runtime locale databases
        # are source payloads too. Replace them, not just the shared objects.
        code = elf(src) or src.suffix in ('.a', '.la') or installed.startswith('/usr/include/') or '/pkgconfig/' in installed
        data = installed.startswith('/usr/share/X11/') and source == 'libx11'
        if code or data:
            assert candidate.is_file() or candidate.is_symlink(), f'No upstream replacement: {package} {installed}'
            copy(candidate, dest)
            changes.append({'installed': installed, 'source_payload': str(candidate.relative_to(stage))})
        elif candidate.is_file() or candidate.is_symlink():
            copy(candidate, dest)
            changes.append({'installed': installed, 'source_payload': str(candidate.relative_to(stage))})
        elif installed.endswith('.gz') and (manual := stage / installed.lstrip('/').removesuffix('.gz')).is_file():
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(gzip.compress(manual.read_bytes(), mtime=0))
            changes.append({'installed': installed, 'source_payload': str(manual.relative_to(stage))})
        else:
            # Debian integration scripts, metadata and translated documentation.
            # No old ELF/archive/header/locale entry may reach this branch.
            copy(src, dest)
    for family in sorted(family_names):
        candidates = list((stage / 'usr/lib' / triplet).glob(family + '*'))
        assert candidates, f'No upstream SONAME family: {package} {family}'
        old_real = [captured / 'files' / path.lstrip('/') for path in inventory
                    if re.fullmatch(re.escape(family) + r'(?:\.\d+)*', Path(path).name)
                    and elf(captured / 'files' / path.lstrip('/'))]
        new_real = [path for path in candidates if elf(path)]
        assert len(new_real) == 1 and old_real, f'Ambiguous ABI family {family}'
        for old in old_real:
            missing = exports(old) - exports(new_real[0])
            assert not missing, f'Lost ABI exports {package} {family}: {sorted(missing)}'
        for new in candidates:
            copy(new, root / 'usr/lib' / triplet / new.name)
            changes.append({'installed': '/usr/lib/' + triplet + '/' + new.name,
                            'source_payload': str(new.relative_to(stage))})
    assert changes, f'No replaced payload for {package}'
    doc = root / 'usr/share/doc' / package
    doc.mkdir(parents=True, exist_ok=True)
    source_root = Path('/xorg-build') / ('xserver' if source == 'xorg-server' else receipt['name'])
    for license_name in ('COPYING', 'COPYING-Xlib', 'COPYING-Xserver'):
        if (source_root / license_name).is_file():
            copy(source_root / license_name, doc / (license_name + '.upstream'))
    (doc / 'runtime-source.json').write_text(json.dumps({
        'source': source, 'version': version, 'archive': receipt,
        'baseline_version': original['Version'], 'replaced': changes,
        'retained_components': retained_components,
        'retained_integration': (receipt.get('package_policy') or 'Installed Debian scripts and ancillary documentation retained; all captured ELF, static archives, headers and Xlib locale payloads replaced.'),
        'xserver_common': 'Unchanged Debian data package keeps original version; no server-code clearance inferred from its source name.'
    }, indent=2) + '\n')
    roots[package], metadata[package], replacements[package] = root, original, family_names

# The local shlibs map binds dependencies to the packages actually emitted.
local_shlibs = out / 'shlibs'
local_shlibs.write_text(''.join(f'{family.rsplit(".so.", 1)[0]} {family.rsplit(".so.", 1)[1]} {p} (>= {versions[p]})\n'
                              for p, names in replacements.items() for family in sorted(names)))
work = out / 'metadata'
(work / 'debian').mkdir(parents=True, exist_ok=True)
(work / 'debian/control').write_text('Source: runtime-xorg\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\n' +
    '\n'.join(f'Package: {p}\nArchitecture: any\nDescription: verified upstream runtime\n' for p in roots))
keep = {'Section', 'Priority', 'Essential', 'Multi-Arch', 'Provides', 'Breaks', 'Replaces', 'Pre-Depends',
        'Depends', 'Conflicts', 'Recommends', 'Suggests', 'Enhances', 'Architecture'}
for package, root in roots.items():
    control = root / 'DEBIAN'
    control.mkdir()
    old = metadata[package]
    new = {key: value for key, value in old.items() if key in keep}
    source = (profile / package / 'source').read_text().strip()
    new.update(Package=package, Source=source, Version=versions[package],
               Maintainer='Runtime Maintainers <maintainers@example.invalid>',
               Description='Verified upstream ' + source + ' runtime')
    objects = [path for path in root.rglob('*') if elf(path)]
    dependencies = ''
    if objects:
        result = subprocess.check_output(['dpkg-shlibdeps', '-O', '-x' + package,
            '-l' + str(stage / 'usr/lib' / triplet), '-L' + str(local_shlibs)] +
            ['-e' + str(path) for path in objects], cwd=work, text=True)
        dependencies = next(line.split('=', 1)[1] for line in result.splitlines() if line.startswith('shlibs:Depends='))
        assert dependencies, package
        for path in objects:
            if source == 'x11-xkb-utils' and '/' + str(path.relative_to(root)) != '/usr/bin/xkbcomp':
                # Preserve the recorded byte identity of untouched bundle tools.
                continue
            subprocess.run(['strip', '--strip-unneeded', str(path)], check=True)
        if source == 'x11-xkb-utils':
            receipt = json.loads((root / 'usr/share/doc' / package / 'runtime-source.json').read_text())
            for retained in receipt['retained_components']:
                payload = root / retained['installed'].lstrip('/')
                assert hashlib.sha256(payload.read_bytes()).hexdigest() == retained['sha256'], retained['installed']
    original_deps = new.get('Depends', '')
    for rebuilt, version in versions.items():
        original_deps = re.sub(r'(?<![A-Za-z0-9+.-])' + re.escape(rebuilt) + r'\s*\([^)]*\)', rebuilt + ' (>= ' + version + ')', original_deps)
    combined = list(dict.fromkeys(part.strip() for part in (original_deps + ',' + dependencies).split(',') if part.strip()))
    if combined:
        new['Depends'] = ', '.join(combined)
    for suffix in ('preinst', 'postinst', 'prerm', 'postrm', 'triggers', 'conffiles'):
        src = profile / package / 'control-files' / suffix
        if src.is_file():
            copy(src, control / suffix)
    if replacements[package]:
        (control / 'shlibs').write_text(''.join(line + '\n' for line in local_shlibs.read_text().splitlines() if f' {package} (' in line))
    (control / 'control').write_text(''.join(key + ': ' + value + '\n' for key, value in new.items()))
    subprocess.run(['dpkg-deb', '--build', '--root-owner-group', str(root), str(out / (package + '.deb'))], check=True)
