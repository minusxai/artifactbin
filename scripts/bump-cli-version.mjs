import { readFile, writeFile } from 'node:fs/promises';

// Run from the repository root. Release PRs use the smallest semver bump by default.
if (process.argv.length > 2) throw new Error('Usage: npm run release:cli (increments the patch version)');
const pkgPath = 'services/cli/package.json';
const installerPath = 'services/app/public/chat/install.sh';
// The pointer the CLI reads to resolve its compatible release; it moves with the installer.
const pointerPath = 'services/app/public/chat/release.json';
const [pkgText, lockText, installer, pointerText] = await Promise.all([
  readFile(pkgPath, 'utf8'), readFile('package-lock.json', 'utf8'), readFile(installerPath, 'utf8'), readFile(pointerPath, 'utf8'),
]);
const pkg = JSON.parse(pkgText);
const lock = JSON.parse(lockText);
const pointer = JSON.parse(pointerText);
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!parts || !installer.includes(`  version=${pkg.version}\n`) || pointer.version !== pkg.version) {
  throw new Error('CLI, installer and release pointer versions must match before bumping');
}
const next = `${parts[1]}.${parts[2]}.${BigInt(parts[3]) + 1n}`;
lock.packages['services/cli'].version = next;
await writeFile(pkgPath, pkgText.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
await writeFile('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
await writeFile(installerPath, installer.replace(`version=${pkg.version}\n`, `version=${next}\n`).replace(`--version ${pkg.version}`, `--version ${next}`));
await writeFile(pointerPath, pointerText.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
console.log(`afbin ${pkg.version} → ${next}. Commit these changes in a release PR; main CI publishes automatically.`);
