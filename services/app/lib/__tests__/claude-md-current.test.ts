/** P4 (seeded RED) — CLAUDE.md is the repo's memory; a sentence that names a retired mechanism is worse than none. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const md = readFileSync(path.resolve(__dirname, '../../../../CLAUDE.md'), 'utf8');

describe('CLAUDE.md is current after the folders work', () => {
  it('no longer names retired mechanisms', () => {
    for (const stale of ['instrumentation.ts', 'verifyObjectStore', 'folder_not_empty', "'2026/08/12'", 'Materialized folder path', 'deleteArtifactScoped']) {
      expect(md, stale).not.toContain(stale);
    }
  });
  it('carries one bullet for folders and one for the trash', () => {
    for (const must of ['ancestor_ids', 'format: \'folder\'', '<Files', 'deleted_at', 'LIVE_ARTIFACT_SQL', 'lib/trash', 'purge']) {
      expect(md, must).toContain(must);
    }
  });
});
