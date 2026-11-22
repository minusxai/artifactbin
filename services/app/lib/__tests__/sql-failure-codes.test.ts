/**
 * ONE LIST OF WHY A PAGE'S `sql` FAILED (contracts sql-failures). Every layer on a page read's path answers a code from
 * it: the connectors through `SQL_FAILURE_FOR_CONNECTOR` (one entry per connector code, checked here and by the type),
 * the page SQL door and its stored-dataset, live-dataset and default-connection parts, the page runtime's `sql` and
 * its offline and relay paths, and `<af-chart>` and `<af-data-table>`. This guard reads each of those sources and
 * fails on a code written there that is not in the list; the author skill's datasets reference names only listed
 * codes, and every kind of failed read among them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_ERROR_CODES, OWN_CONNECTIONS_OFF } from '@artifactbin/contracts/connectors';
import { SQL_FAILURE_FOR_CONNECTOR, SQL_FAILURES } from '@artifactbin/contracts/sql-failures';
import { REPO_ROOT } from '@/test/helpers/source-files';

const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8');
/** One top-level function's text, from its signature to the first line that closes it. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`${signature} is gone: point this guard at where it moved`);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end < 0 ? undefined : end);
}
/** Every code literal the shapes on these paths write: a refusal helper's first argument, an `error:` or `code:` field. */
const CODE_SITES = [
  /\b(?:refuse|fail|reply|refusal|sqlReadFailure|failure|own|ownFailure)\(\s*'([a-z_]+)'/g,
  /\bnew SqlError\(\s*'([a-z_]+)'/g,
  /\bLiveDatasetRefusal\(\s*\d+\s*,\s*(?:[^,'()]*\?\s*)?'([a-z_]+)'(?:\s*:\s*'([a-z_]+)')?/g,
  /\b(?:error|code)\s*:\s*['"]([a-z_]+)['"]/g,
  /\berror\(\s*[^;]*?,\s*'([a-z_]+)'\s*\)/g,
  /\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'\)\s*as SqlFailureCode/g,
  /\berror\.code\s*:\s*'([a-z_]+)'/g,
];
const codesIn = (text: string): string[] => [...new Set(CODE_SITES.flatMap((site) => [...text.matchAll(site)].flatMap((m) => m.slice(1).filter((c): c is string => !!c))))];

/** Each source on a page read's path, as the part of it that answers a page (a file's other doors keep their own codes). */
const LAYERS: Record<string, () => string> = {
  'the stored-dataset door': () => read('services/app/lib/dataset-access/page-sql-door.ts') + read('services/app/lib/dataset-access/page-sql.ts')
    + body(read('services/app/lib/dataset-access/linked.ts'), 'function refusal('),
  'the page SQL door': () => read('services/app/lib/page-doors/index.ts'),
  'the default connection': () => read('services/app/lib/connections/index.ts'),
  'live datasets': () => {
    const source = read('services/app/lib/live-datasets/index.ts');
    return ['async function connectionOf(', 'function refused(', 'async function run(', 'export async function pageLiveDatasetSql('].map((s) => body(source, s)).join('\n');
  },
  'the page runtime': () => ['apollo/sql.ts', 'browser-client.ts', 'offline-sql.ts', 'portable-chrome-contract.ts', 'domain-reads.ts'].map((f) => read(`services/app/lib/html-runtime/${f}`)).join('\n'),
  'the frame relay': () => read('services/app/lib/html-reader/frame-bridge/parent.ts').split('\n').filter((line) => line.includes('/sql`') && line.includes('reply(')).join('\n'),
  // <af-chart> and <af-data-table> take every code from the failure they show, or the one their shared spec names.
  'the components': () => ['html-components/chart-data.ts', 'html-components/chart-frame.ts', 'html-components/data-table-measure.ts', 'html-component-specs/read-failure.ts'].map((f) => read(`services/app/lib/${f}`)).join('\n'),
};

describe('the one list of sql failure codes', () => {
  it('maps every connector code into it, each kind to its own code', () => {
    expect(Object.keys(SQL_FAILURE_FOR_CONNECTOR).sort()).toEqual([...CONNECTOR_ERROR_CODES].sort());
    // The kinds a reader must tell apart never share a code.
    const kinds = { access: 'permission_denied', down: 'connect_failed', invalid: 'database_error', time: 'timeout', missing: 'not_found' } as const;
    const mapped = Object.values(kinds).map((c) => SQL_FAILURE_FOR_CONNECTOR[c]);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('takes the install\'s refusal of dataset-owned connections, which a page\'s live read answers, from the list', () => {
    expect(SQL_FAILURES[OWN_CONNECTIONS_OFF.error].status).toBe(OWN_CONNECTIONS_OFF.status);
  });

  it.each(Object.keys(LAYERS))('%s answers only listed codes', (layer) => {
    const codes = codesIn(LAYERS[layer]!());
    expect(codes.length, `${layer}: the guard found no code; its patterns no longer match the source`).toBeGreaterThan(0);
  });

  it('gives every failed read a sentence for the reader, and the skill names only listed codes, every read code among them', () => {
    const reads = ['permission_denied', 'sign_in_required', 'unavailable', 'validation_failed', 'timeout', 'result_too_large', 'dataset_not_found', 'unknown_query', 'consent_required'] as const;
    for (const code of reads) expect(SQL_FAILURES[code].notice, code).toMatch(/^[A-Z].*\.$/);
    const doc = read('services/app/skills/artifactbin/references/datasets.md');
    const listed = /Read codes: ([^.]*)\./.exec(doc.replace(/\s+/g, ' '))?.[1] ?? '';
    const named = [...listed.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect(named.sort()).toEqual([...reads].sort());
  });
});
