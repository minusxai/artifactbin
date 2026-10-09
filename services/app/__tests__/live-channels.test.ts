/**
 * ONE CHANNEL FORMULA. A document's wakeups and its annotations' wakeups are named by
 * `artifactChannel`/`annotationsChannel` (services/contracts), which the LISTEN side and
 * every TypeScript pg_notify use. Several writes notify from inside SQL instead
 * (`'artifact_' || lower(id)`), so this pins the two spellings to one answer on the real
 * database, mixed case included: unquoted LISTEN folds case, pg_notify does not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotationsChannel, artifactChannel } from '@artifactbin/contracts';
import { getDb } from '@/lib/platform/db';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const MIXED = 'AbC9xYz';
const LIB = path.resolve(__dirname, '../lib');
const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const file = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(file);
  return /\.tsx?$/.test(e.name) ? [file] : [];
});

describe('live channel names', () => {
  it('the SQL spelling and the contract agree on a mixed-case id', async () => {
    const db = await getDb();
    const r = await db.query<{ doc: string; notes: string }>(
      "SELECT 'artifact_' || lower($1) AS doc, 'annotations_' || lower($1) AS notes", [MIXED],
    );
    expect(r.rows[0]).toEqual({ doc: artifactChannel(MIXED), notes: annotationsChannel(MIXED) });
    expect(artifactChannel(MIXED)).toBe('artifact_abc9xyz');
    expect(annotationsChannel(MIXED)).toBe('annotations_abc9xyz');
  });

  it('every SQL notify in lib/ spells the document channel the same way', () => {
    const odd = sources(LIB).flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/'artifact_'(?!\s*\|\|\s*lower\()/g)]
      .map(() => path.relative(LIB, file)));
    expect(odd).toEqual([]);
  });
});
