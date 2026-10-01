/**
 * Gate: the offline file (scripts/gates/gate-offline-file.mjs) in WebKit alone, on a shard of its own, so only
 * that shard installs WebKit's system packages.
 *
 *   usage: node scripts/gates/gate-offline-file-webkit.mjs [base]
 */
process.argv[3] = 'webkit';
await import('./gate-offline-file.mjs');
