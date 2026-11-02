import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE INSTALL CACHE KEY THAT A RELEASE DOES NOT INVALIDATE.
 *
 * `install-v3` keyed on hashFiles('package-lock.json'), and `npm run release:cli` rewrites one line
 * of that file — the CLI workspace's own version. Measured on release PR run 35325636096, job
 * `CLI (macos-15-intel)`: "Cache not found for input keys: install-v3-macOS-X64-node22-a979…",
 * 50s of `npm ci` and 29s of cache-post, while the three caches beside it (Chromium, the prebuilt
 * Node, the Chromium archive) all restored on that same runner — they key on files a bump does not
 * touch. The version of a workspace resolves no dependency, so it has no business in the key.
 *
 * CI hashes this (`node scripts/ci/ci.mjs lock-fingerprint`), and so does the gate container's
 * dependency volume (scripts/gate-container.mjs), so both caches turn over on the same changes.
 *
 * @param {string} lockText  package-lock.json's contents
 * @returns {string} the lockfile with every workspace version normalised, as JSON
 */
export function normalisedLock(lockText) {
  const lock = JSON.parse(lockText);
  for (const [name, meta] of Object.entries(lock.packages ?? {})) {
    if (!name.includes('node_modules/') && meta?.version) meta.version = '0.0.0-fingerprint';
  }
  return JSON.stringify(lock);
}

/** Whole-install inputs, including the postinstall products cached outside node_modules.
 * Font bytes come from locked npm packages. Design-system authoring assets are not read
 * by postinstall and deliberately do not invalidate this cache. Missing inputs are encoded
 * so additions/removals also invalidate; npm ci remains responsible for install validity.
 */
export function installFingerprint(root = '.') {
  const lock = normalisedLock(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const workspaces = Object.keys(JSON.parse(lock).packages ?? {}).filter(name => !name.includes('node_modules'));
  const files = [...new Set(['package.json', ...workspaces.map(name => path.posix.join(name, 'package.json')),
    '.npmrc', 'services/app/scripts/copy-assets.mjs', 'services/app/scripts/system-font-packages.mjs'])].sort();
  const inputs = Object.fromEntries(files.map(file => {
    const full = path.join(root, file);
    if (!existsSync(full)) return [file, null];
    let text = readFileSync(full, 'utf8');
    if (file.endsWith('package.json')) {
      const manifest = JSON.parse(text);
      delete manifest.version; // Workspace release versions resolve no dependency.
      text = JSON.stringify(manifest);
    }
    // Configuration may contain registry credentials; retain only its digest, never its text.
    return [file, createHash('sha256').update(text).digest('hex')];
  }));
  return JSON.stringify({ lock: JSON.parse(lock), inputs });
}
