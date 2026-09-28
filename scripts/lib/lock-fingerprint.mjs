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
 * CI hashes this (`node scripts/ci.mjs lock-fingerprint`), and so does the gate container's
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
