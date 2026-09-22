import { readFile, writeFile } from 'node:fs/promises';

// Run from the repository root: `npm run release:cli -- [patch|minor|major]`, patch by default.
const LEVELS = ['patch', 'minor', 'major'];
const level = process.argv[2] ?? 'patch';
if (process.argv.length > 3 || !LEVELS.includes(level)) throw new Error(`Usage: npm run release:cli -- [patch|minor|major] — the bump level is patch, minor or major, not ${JSON.stringify(process.argv.slice(2).join(' '))}`);
const pkgPath = 'services/cli/package.json';
const installerPath = 'services/app/public/chat/install.sh';
// The pointer the CLI reads to resolve its compatible release; it moves with the installer.
const windowsPath = 'services/app/public/chat/install.ps1';
const windowsInstaller = await readFile(windowsPath,'utf8');
const pointerPath = 'services/app/public/chat/release.json';
const [pkgText, lockText, installer, pointerText] = await Promise.all([
  readFile(pkgPath, 'utf8'), readFile('package-lock.json', 'utf8'), readFile(installerPath, 'utf8'), readFile(pointerPath, 'utf8'),
]);
const pkg = JSON.parse(pkgText);
const lock = JSON.parse(lockText);
const pointer = JSON.parse(pointerText);
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!windowsInstaller.includes(`$Version = '${pkg.version}'`) || !parts || !installer.includes(`  version=${pkg.version}\n`) || pointer.version !== pkg.version) {
  throw new Error('CLI, installer and release pointer versions must match before bumping');
}
const [major, minor, patch] = [parts[1], parts[2], parts[3]].map(BigInt);
const next = level === 'major' ? `${major + 1n}.0.0` : level === 'minor' ? `${major}.${minor + 1n}.0` : `${major}.${minor}.${patch + 1n}`;
lock.packages['services/cli'].version = next;
await writeFile(pkgPath, pkgText.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
await writeFile('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
await writeFile(installerPath, installer.replace(`version=${pkg.version}\n`, `version=${next}\n`).replace(`--version ${pkg.version}`, `--version ${next}`));
await writeFile(windowsPath,windowsInstaller.replace(`$Version = '${pkg.version}'`,`$Version = '${next}'`));
await writeFile(pointerPath, pointerText.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
console.log(`afbin ${pkg.version} → ${next}. Land the version files with the change that needs them; teaching is generated at build time; successful main CI publishes the tested release assets.`);
