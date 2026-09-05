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
  /*
   * THE FOLDER PAGE. The folder bullet described a mechanism that is gone: the
   * create door stamped a two-line SCAFFOLD as the row's `source` and the
   * folder was served as the document it was, `lib/story-ui/folder-head`
   * decorating it. The row carries no content now and the listing is app
   * chrome painted from the page bootstrap — so the bullet has to name where
   * that lives, or the next reader goes hunting for a stored source that no
   * longer exists and a component that no longer renders it.
   */
  it('the folder bullet names the app-chrome page, not the retired scaffold', () => {
    for (const must of ['web/pages/Folder.tsx', "kind: 'folder'"]) expect(md, must).toContain(must);
    for (const stale of ['scaffold', 'folder-head', 'folderScaffold']) expect(md, stale).not.toContain(stale);
  });
});
