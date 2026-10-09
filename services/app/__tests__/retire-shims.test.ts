/**
 * The shim-retirement scripts that outlive the backfills (scripts/migrate/retire-shims):
 * legacy-anchors republishes the live documents still carrying `data-annotation-anchor`
 * (a second run finds nothing). Fixture rows
 * are inserted as the old shapes stood; no script ever runs against anything but this
 * isolated PGLite.
 */
import { describe, expect, it } from 'vitest';
import { getArtifactById } from '@/lib/artifacts';
import { createDocumentGraph } from '@/lib/document/document-graph';
import { useAppHarness } from './harness';
import { formatReport } from '../../../scripts/migrate/retire-shims/common';
import { retireAnchorAttributes, run as retireAnchors } from '../../../scripts/migrate/retire-shims/legacy-anchors';

const harness = useAppHarness();
const dry = { apply: false } as const;
const apply = { apply: true } as const;
const PLAIN = '<p id="plin">plain</p>';
const MARKED = { dataSyntax: 2 };

/** A head as production stores one: its graph, the source column empty. */
async function head(id: string, source: string, meta: Record<string, unknown> = MARKED, trashed = false) {
  const db = await harness.db();
  await db.query(
    `INSERT INTO artifacts (id,token_id,document,format,version,meta,deleted_at) VALUES ($1,'tok_retire',$2::jsonb,'markup',1,$3,${trashed ? 'now()' : 'NULL'})`,
    [id, JSON.stringify(createDocumentGraph(source, 1, { preserveSource: true })), JSON.stringify(meta)],
  );
}
const anchorOf = async (id: string) => (await (await harness.db()).query<{ anchor_key: string | null }>('SELECT anchor_key FROM annotations WHERE id=$1', [id])).rows[0]!.anchor_key;
async function comment(id: string, artifact: string, anchor: string) {
  await (await harness.db()).query(`INSERT INTO annotations(id,artifact_id,body,author_kind,anchor_key) VALUES ($1,$2,'Comment','human',$3)`, [id, artifact, anchor]);
}

describe('retireAnchorAttributes: the one-off transform', () => {
  it('drops every attribute, promotes a free key to the id of an element without one, and reports each key by path', () => {
    const retired = retireAnchorAttributes('<main><p data-annotation-anchor="Ab12">A</p><p id="keep" data-annotation-anchor="Zz99">B</p><p id="Qq77">C</p><p data-annotation-anchor="Qq77">D</p></main>');
    expect(retired.source).not.toContain('data-annotation-anchor');
    expect(retired.source).toContain('<p id="Ab12">A</p>');
    expect(retired.source).toContain('<p>D</p>');
    expect(retired.keys).toEqual([{ key: 'Ab12', path: '0.0' }, { key: 'Zz99', path: '0.1' }, { key: 'Qq77', path: '0.3' }]);
  });
});

describe('legacy-anchors: live documents lose data-annotation-anchor', () => {
  it('republishes through the publish path, keeps the annotation anchored, and skips trashed rows', async () => {
    const legacy = '<main><p data-annotation-anchor="Ab12">Revenue grew.</p></main>';
    await head('anch', legacy);
    await head('anchtrash', legacy, MARKED, true);
    await head('clean', PLAIN);
    const db = await harness.db();
    await comment('ann_1', 'anch', 'Ab12');

    const preview = await retireAnchors(db, dry);
    expect(preview.candidates).toBe(2);
    expect(preview.changed).toEqual(['anch']);
    expect(preview.blocked).toEqual([{ id: 'anchtrash', reason: expect.stringContaining('trashed') }]);
    expect((await getArtifactById('anch'))!.source).toContain('data-annotation-anchor');

    const applied = await retireAnchors(db, apply);
    expect(applied.blocked.map((b) => b.id)).toEqual(['anchtrash']);
    expect(applied.changed).toEqual(['anch']);
    const after = (await getArtifactById('anch'))!;
    expect(after.source).not.toContain('data-annotation-anchor');
    expect(after.version).toBe(2);
    // The comment still names a node that exists.
    expect(after.source).toContain(`id="${await anchorOf('ann_1')}"`);
    expect((await retireAnchors(db, apply)).changed).toEqual([]);
  });

  it('repoints a comment whose legacy key sat beside an authored id to that id', async () => {
    await head('alias', '<main><p id="keep" data-annotation-anchor="Zz99">x</p></main>');
    await comment('ann_3', 'alias', 'Zz99');
    const db = await harness.db();
    const lines: string[] = [];
    expect((await retireAnchors(db, { ...apply, log: (line) => lines.push(line) })).changed).toEqual(['alias']);
    expect(await anchorOf('ann_3')).toBe('keep');
    expect(lines).toContain('repointed alias annotation ann_3 (anchor Zz99 -> keep)');
    expect((await getArtifactById('alias'))!.source).not.toContain('data-annotation-anchor');
  });

  it('refuses a document whose annotation anchor would stop resolving, unless told to detach it', async () => {
    await head('orphan', '<main><p id="keep" data-annotation-anchor="Zz99">x</p></main>');
    await comment('ann_2', 'orphan', 'Qq77');
    await comment('ann_4', 'orphan', 'keep');
    const db = await harness.db();
    const refused = await retireAnchors(db, apply);
    expect(refused.changed).toEqual([]);
    expect(refused.blocked[0]?.reason).toContain('Qq77');
    expect((await getArtifactById('orphan'))!.source).toContain('data-annotation-anchor');

    const lines: string[] = [];
    const preview = await retireAnchors(db, { ...dry, detachOrphanedAnchors: true, log: (line) => lines.push(line) });
    expect(preview.changed).toEqual(['orphan']);
    expect(lines).toContain('would detach orphan annotation ann_2 (anchor Qq77)');
    expect(preview.notes).toContain('annotation anchors that would be detached: 1');
    expect(await anchorOf('ann_2')).toBe('Qq77');

    const detached = await retireAnchors(db, { ...apply, detachOrphanedAnchors: true });
    expect(detached.changed).toEqual(['orphan']);
    expect(formatReport(detached)).toContain('annotation anchors detached: 1');
    expect(await anchorOf('ann_2')).toBeNull();
    expect(await anchorOf('ann_4')).toBe('keep');
    expect((await getArtifactById('orphan'))!.source).not.toContain('data-annotation-anchor');
    // A second run is a no-op: nothing carries the attribute, and a detached comment is no candidate.
    const again = await retireAnchors(db, { ...apply, detachOrphanedAnchors: true });
    expect([again.candidates, again.changed, again.blocked]).toEqual([0, [], []]);
  });
});
