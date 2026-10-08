/**
 * The shim-retirement backfills (scripts/migrate/retire-shims): each one's dry run
 * writes nothing, its apply writes what the README says, and a second apply finds
 * nothing. Fixture rows are inserted as the old shapes stood; no script ever
 * runs against anything but this isolated PGLite.
 */
import { describe, expect, it } from 'vitest';
import { artifactQuery, getArtifactById } from '@/lib/artifacts';
import { hasCurrentDataSyntax } from '@/lib/story/data/data-syntax';
import { RETIRED_STORY_THEMES } from '@/lib/data/story/story-themes';
import { useAppHarness } from './harness';
import { formatReport } from '../../../scripts/migrate/retire-shims/common';
import { run as backfillVersions } from '../../../scripts/migrate/retire-shims/sqlite-versions';
import { run as retireThemes } from '../../../scripts/migrate/retire-shims/retired-themes';
import { run as graphDocuments } from '../../../scripts/migrate/retire-shims/source-kind-documents';
import { run as retireAnchors } from '../../../scripts/migrate/retire-shims/legacy-anchors';
import { bareScriptVerdict, run as detectBareScripts } from '../../../scripts/migrate/retire-shims/bare-scripts';

const harness = useAppHarness();
const dry = { apply: false } as const;
const apply = { apply: true } as const;

/** The previous engine's integer division: converted by the data-syntax migration. */
const HALF = '<Helmet><Query name="ratio">{`select 7 / 2 as h`}</Query></Helmet><DataTable data="$ratio" />';
const NEEDS_A_PERSON = `<Helmet>
  <Value name="step" type="number" default={0} />
  <Mutation name="next">{\`update _signals set step = step + 1\`}</Mutation>
</Helmet>
<Button run="$next">Next</Button>`;
const PLAIN = '<p id="plin">plain</p>';
const MARKED = { dataSyntax: 2 };

async function head(id: string, source: string, meta: Record<string, unknown> = {}, trashed = false) {
  const db = await harness.db();
  await db.query(
    `INSERT INTO artifacts (id,token_id,source,format,version,meta,deleted_at) VALUES ($1,'tok_retire',$2,'markup',1,$3,${trashed ? 'now()' : 'NULL'})`,
    [id, source, JSON.stringify(meta)],
  );
}
async function version(id: string, n: number, source: string | null, meta: Record<string, unknown> = {}, document: unknown = null) {
  const db = await harness.db();
  await db.query(`INSERT INTO artifact_versions (artifact_id,version,format,source,document,meta) VALUES ($1,$2,'markup',$3,$4::jsonb,$5)`,
    [id, n, source, document === null ? null : JSON.stringify(document), JSON.stringify(meta)]);
}
const rowOf = async (sql: string, params: unknown[]) => (await artifactQuery<Record<string, any>>(await harness.db(), sql, params)).rows[0]!;

describe('sqlite-versions: archived versions and trashed heads to dataSyntax 2', () => {
  async function fixture() {
    await head('live', PLAIN, MARKED);
    await head('trash', HALF, {}, true);
    await head('manual', PLAIN, MARKED);
    await head('same', PLAIN, MARKED);
    await version('live', 1, HALF);
    await version('same', 1, PLAIN);
    await version('manual', 1, NEEDS_A_PERSON);
  }

  it('a dry run reports and writes nothing; apply converts in place, keeps what needs a person, and is idempotent', async () => {
    await fixture();
    const db = await harness.db();

    const preview = await backfillVersions(db, dry);
    expect(preview.candidates).toBe(4);
    expect([...preview.changed].sort()).toEqual(['live@1', 'same@1', 'trash']);
    expect(preview.blocked.map((b) => b.id)).toEqual(['manual@1']);
    expect(formatReport(preview)).toContain('UNLOCKS NOTHING YET');
    expect((await rowOf('SELECT source, meta FROM artifact_versions WHERE artifact_id=$1 AND version=1', ['live'])).source).toBe(HALF);
    expect(hasCurrentDataSyntax((await rowOf('SELECT meta FROM artifacts WHERE id=$1', ['trash'])).meta)).toBe(false);

    const logged: string[] = [];
    const applied = await backfillVersions(db, { apply: true, log: (line) => logged.push(line) });
    expect([...applied.changed].sort()).toEqual(['live@1', 'same@1', 'trash']);
    expect(logged.sort()).toEqual(['changed live@1', 'changed same@1', 'changed trash']);

    const archived = await rowOf('SELECT source, document, meta FROM artifact_versions WHERE artifact_id=$1 AND version=1', ['live']);
    expect(archived.source).not.toBe(HALF);
    expect(archived.source).toContain('select');
    expect(archived.document.kind).toBe('graph');
    expect(hasCurrentDataSyntax(archived.meta)).toBe(true);
    expect(archived.meta.dataSyntaxMigration).toMatchObject({ job: 'retire-shims:sqlite-versions', from: 1 });

    const trashed = await rowOf('SELECT source, meta, version, edit_id, deleted_at FROM artifacts WHERE id=$1', ['trash']);
    expect(hasCurrentDataSyntax(trashed.meta)).toBe(true);
    expect(trashed.source).not.toBe(HALF);
    expect(trashed.version).toBe(1);
    expect(trashed.deleted_at).not.toBeNull();
    // Unchanged documents are only marked.
    expect(hasCurrentDataSyntax((await rowOf('SELECT meta FROM artifact_versions WHERE artifact_id=$1', ['same'])).meta)).toBe(true);
    // The row that needs a person is untouched.
    const untouched = await rowOf('SELECT source, meta FROM artifact_versions WHERE artifact_id=$1', ['manual']);
    expect(untouched.source).toBe(NEEDS_A_PERSON);
    expect(hasCurrentDataSyntax(untouched.meta)).toBe(false);

    const again = await backfillVersions(db, apply);
    expect(again.changed).toEqual([]);
    expect(again.candidates).toBe(1);
  });
});

describe('retired-themes: classical becomes manuscript on heads and versions', () => {
  it('derives the successor from the registry, counts versions, and leaves other themes alone', async () => {
    const [retired, successor] = Object.entries(RETIRED_STORY_THEMES)[0]!.flatMap((value, i) => i === 0 ? [value as string] : [(value as { successor: string }).successor]);
    await head('old', PLAIN, { theme: retired, colorMode: 'light' });
    await head('oldtrash', PLAIN, { theme: retired }, true);
    await head('fine', PLAIN, { theme: 'modernist' });
    await version('old', 1, PLAIN, { theme: retired });
    const db = await harness.db();

    const preview = await retireThemes(db, dry);
    expect(preview.candidates).toBe(3);
    expect(preview.notes).toContain('heads naming a retired theme: 2');
    expect(preview.notes).toContain('versions naming a retired theme: 1');
    expect((await rowOf('SELECT meta FROM artifacts WHERE id=$1', ['old'])).meta.theme).toBe(retired);

    const applied = await retireThemes(db, apply);
    expect([...applied.changed].sort()).toEqual(['old', 'old@1', 'oldtrash']);
    expect((await rowOf('SELECT meta FROM artifacts WHERE id=$1', ['old'])).meta).toMatchObject({ theme: successor, colorMode: 'light' });
    expect((await rowOf('SELECT meta FROM artifacts WHERE id=$1', ['oldtrash'])).meta.theme).toBe(successor);
    expect((await rowOf('SELECT meta FROM artifact_versions WHERE artifact_id=$1', ['old'])).meta.theme).toBe(successor);
    expect((await rowOf('SELECT meta FROM artifacts WHERE id=$1', ['fine'])).meta.theme).toBe('modernist');
    expect((await retireThemes(db, apply)).candidates).toBe(0);
  });
});

describe('source-kind-documents: stored documents become graphs', () => {
  it('migrates a parseable non-canonical archive, reports an unparseable one, and counts the legacy kinds', async () => {
    await head('hd', PLAIN, MARKED);
    // Extra whitespace: parses, but does not re-serialize to the same bytes, so it is stored as kind "source".
    const loose = '<p  id="loos">spaced</p>';
    await version('hd', 1, null, MARKED, { schema: 1, kind: 'source', source: loose });
    await version('hd', 2, null, MARKED, { schema: 1, kind: 'source', source: '<div' });
    const db = await harness.db();

    const preview = await graphDocuments(db, dry);
    // The head is a legacy `source`-column row; the two versions are stored as kind "source".
    expect(preview.candidates).toBe(3);
    expect([...preview.changed].sort()).toEqual(['hd', 'hd@1']);
    expect(preview.blocked.map((b) => b.id)).toEqual(['hd@2']);
    expect(preview.notes).toContain('version source: 2');
    expect(preview.notes).toContain('head <null>: 1');
    expect((await rowOf('SELECT document FROM artifact_versions WHERE artifact_id=$1 AND version=1', ['hd'])).document.kind).toBe('source');

    const applied = await graphDocuments(db, apply);
    expect([...applied.changed].sort()).toEqual(['hd', 'hd@1']);
    const migrated = await rowOf('SELECT document, source FROM artifact_versions WHERE artifact_id=$1 AND version=1', ['hd']);
    expect(migrated.document.kind).toBe('graph');
    expect(migrated.source).toBe(loose);
    // The unparseable archive stays recoverable byte for byte.
    expect((await rowOf('SELECT source, document FROM artifact_versions WHERE artifact_id=$1 AND version=2', ['hd'])).source).toBe('<div');
    expect((await graphDocuments(db, apply)).changed).toEqual([]);
    expect((await rowOf('SELECT document FROM artifacts WHERE id=$1', ['hd'])).document.kind).toBe('graph');
  });
});

describe('legacy-anchors: live documents lose data-annotation-anchor', () => {
  it('republishes through the publish path, keeps the annotation anchored, and skips trashed rows', async () => {
    const legacy = '<main><p data-annotation-anchor="Ab12">Revenue grew.</p></main>';
    await head('anch', legacy, MARKED);
    await head('anchtrash', legacy, MARKED, true);
    await head('clean', PLAIN, MARKED);
    const db = await harness.db();
    await db.query(`INSERT INTO annotations(id,artifact_id,body,author_kind,anchor_key) VALUES ('ann_1','anch','Comment','human','Ab12')`);

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
    const anchor = (await rowOf('SELECT anchor_key FROM annotations WHERE id=$1', ['ann_1'])).anchor_key as string;
    expect(after.source).toContain(`id="${anchor}"`);
    expect((await retireAnchors(db, apply)).changed).toEqual([]);
  });

  it('refuses a document whose annotation anchor the stamped source would not resolve', async () => {
    await head('orphan', '<main><p id="keep">x</p></main>'.replace('<p id="keep">', '<p id="keep" data-annotation-anchor="Zz99">'), MARKED);
    const db = await harness.db();
    await db.query(`INSERT INTO annotations(id,artifact_id,body,author_kind,anchor_key) VALUES ('ann_2','orphan','Comment','human','Qq77')`);
    const report = await retireAnchors(db, apply);
    expect(report.changed).toEqual([]);
    expect(report.blocked[0]?.reason).toContain('Qq77');
    expect((await getArtifactById('orphan'))!.source).toContain('data-annotation-anchor');
  });
});

describe('bare-scripts: the report-only detector', () => {
  const BARE = '<Helmet><script>{`export default () => 1`}</script></Helmet><p>x</p>';
  const BOTH = '<Helmet><script>{`export default () => 1`}</script><script type="server">{`export default () => 2`}</script></Helmet><p>x</p>';
  const SERVER = '<Helmet><script type="server">{`export default () => 2`}</script></Helmet><p>x</p>';

  it('classifies by the runner’s own predicate', () => {
    expect(bareScriptVerdict(BARE)).toBe('used');
    expect(bareScriptVerdict(BOTH)).toBe('shadowed');
    expect(bareScriptVerdict(SERVER)).toBe('none');
    expect(bareScriptVerdict('<p>x</p>')).toBe('none');
  });

  it('lists the documents that depend on the compat branch, never writes, and refuses --apply', async () => {
    await head('bare', BARE, MARKED);
    await head('both', BOTH, MARKED);
    await head('srv', SERVER, MARKED);
    await head('gone', BARE, MARKED, true);
    const db = await harness.db();
    const report = await detectBareScripts(db, dry);
    expect(report.changed).toEqual(['bare']);
    expect(report.blocked.map((b) => b.id)).toEqual(['both']);
    expect(report.notes).toContain('used (bare script is the handler): 1');
    await expect(detectBareScripts(db, apply)).rejects.toThrow(/only reports/);
  });
});
