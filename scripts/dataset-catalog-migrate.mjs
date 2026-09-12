#!/usr/bin/env node
/**
 * DATASET CATALOG MIGRATION — the operator's front door to
 * `POST /api/admin/dataset-catalog`.
 *
 * Unlike the node-identity backfill this one INVENTORIES EVERYTHING FIRST:
 * every preview page is written to a backup directory before a single write
 * goes out, and each apply carries the fingerprints the preview saw, so the
 * server refuses a page that changed underneath the operator.
 *
 *   ADMIN__SECRET=… node scripts/dataset-catalog-migrate.mjs --url https://artifact.example
 *   ADMIN__SECRET=… node scripts/dataset-catalog-migrate.mjs --url https://artifact.example --apply --backup-dir ./migration
 */
import { pathToFileURL } from 'node:url';
import { mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { migrationRequest, parseMigrationArgs as parseShared, redactingWriter, runMigrationMain } from './lib/migration-cli.mjs';

const BACKUP_DIR_FLAG = { '--backup-dir': (out, value) => { out.backupDir = value ?? ''; } };

export const parseMigrationArgs = (argv, environment = process.env) => parseShared(argv, environment, BACKUP_DIR_FLAG);

/** Inventory and persist every page before the first write. The server compares each reviewed snapshot. */
export async function runMigrationCli(options) {
  const write = redactingWriter(options.secret, options.write);
  const endpoint = `${options.url}/api/admin/dataset-catalog`;
  const backupDir = resolve(options.backupDir ?? `artifactbin-migration-${randomUUID()}`);
  let page = 0;
  const saveReport = options.saveReport ?? (async (report) => {
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const file = await open(join(backupDir, `${String(++page).padStart(5, '0')}.json`), 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify({ origin: options.url, ...report }, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
    const directory = await open(backupDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  });
  const request = (input) => migrationRequest({
    fetchFn: options.fetch, endpoint, secret: options.secret, timeoutMs: options.timeoutMs, retries: options.retries, write,
    body: { batchSize: options.batchSize, maxHistoricalVersionsPerArtifact: options.historyLimit ?? 1000, ...input },
  });

  const pages = []; let after; const cursors = new Set(); let blocked = false;
  for (;;) {
    const result = await request({ dryRun: true, ...(after ? { after } : {}) });
    if (!result.report) return result;
    await saveReport(result.report); pages.push(result.report);
    write(`dry-run: processed=${result.report.processed} changed=${result.report.changed} done=${result.report.done}`);
    if (!result.ok) { blocked = true; write(`migration blocked: ${result.report.conflicts.map((c) => `${c.artifactId}:${c.reason}`).join(', ')}`); }
    after = result.report.nextCursor;
    if (!after) break;
    if (cursors.has(after)) return { ok: false, reason: 'no_progress' };
    cursors.add(after);
  }
  write(`migration preview and backups: ${backupDir}`);
  if (blocked) return { ok: false, reason: 'conflict', report: pages.at(-1) };
  if (options.dryRun) return { ok: true, report: pages.at(-1) };
  for (const preview of pages) {
    const expected = Object.fromEntries((preview.plans ?? []).map((plan) => [plan.artifactId, plan.fingerprint]));
    if (!Object.keys(expected).length) continue;
    const result = await request({ dryRun: false, expected });
    if (!result.ok) { write('migration stopped; keep backups and preview again before retrying'); return result; }
    write(`apply: processed=${result.report.processed} changed=${result.report.changed} done=${result.report.done}`);
  }
  const audit = await request({ dryRun: true });
  if (!audit.ok) return audit;
  await saveReport(audit.report);
  if (!audit.report.done || audit.report.changed || audit.report.conflicts?.length) {
    write('migration incomplete: the final audit found remaining work; keep backups and review a fresh preview');
    return { ok: false, reason: 'remaining', report: audit.report };
  }
  write('migration complete: final audit found no remaining reference or catalog changes');
  return { ok: true, report: audit.report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrationMain(() => parseMigrationArgs(process.argv.slice(2)), runMigrationCli);
}
