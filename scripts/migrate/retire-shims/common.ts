/**
 * THE SHARED SHELL OF THE SHIM-RETIREMENT BACKFILLS (see README.md).
 *
 * Every script exports `run(db, { apply, log })` — a pure function of a database
 * handle, which is what its test drives against an isolated PGLite — and ends
 * with `if (isMain(import.meta.url)) await runCli(...)`. The CLI half is the
 * only part that touches the environment:
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/<script>.ts            # dry run (the default)
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/<script>.ts --apply    # writes
 *
 * `DATABASE_URL` is read through the platform config module (lib/platform/config),
 * which reads it once on first import — so app modules are imported only after
 * the environment is settled (./local-services). A dry run opens no
 * transaction and writes nothing. Nothing here is on a boot path or in a workflow.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Db } from '@/lib/platform/db';

export interface BackfillOptions {
  /** False (the default everywhere) reports what would change and writes nothing. */
  apply: boolean;
  /** legacy-anchors only: republish a document whose comments would stop resolving, detaching them. */
  detachOrphanedAnchors?: boolean;
  /** Called once per changed id, as each change commits (dry run: as each would be made). */
  log?: (line: string) => void;
}

export interface BackfillReport {
  script: string;
  apply: boolean;
  /** Rows that matched the legacy shape. */
  candidates: number;
  /** Ids written (apply) or that would be written (dry run). */
  changed: string[];
  /** Ids left alone because a person must look, with the reason. Never written. */
  blocked: Array<{ id: string; reason: string }>;
  /** Counts and facts the README's "unlocks" claims rest on. */
  notes: string[];
}

export const newReport = (script: string, options: BackfillOptions): BackfillReport =>
  ({ script, apply: options.apply, candidates: 0, changed: [], blocked: [], notes: [] });

/** Record one change and say so immediately. */
export function recordChange(report: BackfillReport, options: BackfillOptions, id: string): void {
  report.changed.push(id);
  options.log?.(`${options.apply ? 'changed' : 'would change'} ${id}`);
}

export function formatReport(report: BackfillReport): string {
  const verb = report.apply ? 'changed' : 'would change';
  return [
    `${report.script} (${report.apply ? 'APPLY' : 'dry run'}): ${report.candidates} candidates, ${verb} ${report.changed.length}, blocked ${report.blocked.length}`,
    ...report.notes.map((note) => `  ${note}`),
    ...report.blocked.map((entry) => `  blocked ${entry.id}: ${entry.reason}`),
  ].join('\n');
}

/** True when this module is the process's entry point (not imported by a test). */
export const isMain = (moduleUrl: string): boolean => moduleUrl === pathToFileURL(process.argv[1] ?? '').href;

/** The target with credentials removed, for the line printed before any write. */
function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split('://')[0] + '://…';
  }
}

interface CliOptions {
  /** The script publishes through the app's write path, which needs the query engine in process. */
  services?: boolean;
  /** The script has no write mode. */
  reportOnly?: boolean;
  /** The script takes --detach-orphaned-anchors. */
  detach?: boolean;
}

export async function runCli(name: string, run: (db: Db, options: BackfillOptions) => Promise<BackfillReport>, cli: CliOptions = {}): Promise<void> {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, objects: { type: 'string' }, 'live-objects': { type: 'boolean' },
    'detach-orphaned-anchors': { type: 'boolean' },
  } });
  if (values['detach-orphaned-anchors'] && !cli.detach) throw new Error(`${name} has no --detach-orphaned-anchors`);
  if (values.apply && values['dry-run']) throw new Error('--apply and --dry-run are exclusive');
  if (cli.reportOnly && values.apply) throw new Error(`${name} only reports; it has no --apply`);
  if (!process.env.DATABASE_URL) throw new Error(`usage: DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/${name}.ts [--apply]`);
  if (cli.services) {
    const { useLocalServices } = await import('./local-services');
    await useLocalServices({ db: process.env.DATABASE_URL, objects: values.objects, liveObjects: !!values['live-objects'] });
  }
  // After the environment is set: the config module reads it on first import.
  const [{ DATABASE_URL }, { getDb }] = await Promise.all([import('@/lib/platform/config'), import('@/lib/platform/db')]);
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const apply = !!values.apply;
  console.error(`${name}: ${apply ? 'APPLY to' : 'dry run against'} ${describeTarget(DATABASE_URL)}`);
  const db = await getDb();
  try {
    console.log(formatReport(await run(db, { apply, detachOrphanedAnchors: !!values['detach-orphaned-anchors'], log: (line) => console.log(line) })));
  } finally {
    await db.close();
  }
}
