/**
 * Gate: the offline file (scripts/gate-offline-file.mjs) in Firefox alone, on a shard of its own, so only
 * that shard installs Firefox's system packages.
 *
 *   usage: node scripts/gate-offline-file-firefox.mjs [base]
 */
process.argv[3] = 'firefox';
await import('./gate-offline-file.mjs');
