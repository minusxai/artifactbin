/**
 * The offline file's ArtifactBackend (lib/offline/file-backend): every call the
 * document surface makes, answered from the ArtifactFile it was opened with.
 *
 * Edits are checked against the server's own reference model for a committed
 * DocumentUpdate (lib/story/document-update-history documentAfterOperation —
 * "the executable reference model for SQL tests"), so the file applies an edit
 * exactly as /edits would.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentGraph, DocumentUpdate } from '@artifactbin/contracts';
import { graphSource } from '@/lib/story/document-graph';
import { prepareClientDocumentUpdate } from '@/lib/story/document-update-client';
import { documentAfterOperation } from '@/lib/story/document-update-history';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { isWebUrl } from '@/lib/story/asset-url';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import type { ArtifactBackend, BackendFeature } from '@/lib/artifact-backend/types';
import {
  OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON, parseArtifactFile, sourceDigest, type ArtifactFile,
} from '../file-format';
import {
  CHANGED_OUTSIDE, createFileBackend, fileAssetInliner, LOCAL_DELETE_ONLY, OFFLINE_REASONS, rebuildArtifactFile, snapshotStateFor, sourceChangedOutside,
} from '../file-backend';

const FIXTURE = path.resolve(process.cwd(), '../../scripts/fixtures/offline-file/artifact-file.json');
const fixture = (): ArtifactFile => parseArtifactFile(JSON.parse(readFileSync(FIXTURE, 'utf8')));

function open(file: ArtifactFile = fixture(), name: string | null = 'Asha') {
  const changes: ArtifactFile[] = [];
  const onChange = vi.fn((next: ArtifactFile) => { changes.push(next); });
  const backend = createFileBackend(file, { onChange, author: () => name });
  return { backend, changes, onChange, latest: () => changes.at(-1)! };
}

/** What the editor does: load, prepare an update from the loaded graph, commit it. */
async function edit(backend: ArtifactBackend, change: (source: string) => string, metadata?: DocumentUpdate['metadata']) {
  const head = (await backend.load())!;
  const update = prepareClientDocumentUpdate(
    // As use-live-edits prepares it: the snapshot, with the title and description beside the meta.
    { document: head.document!, version: head.version, meta: { title: head.title, theme: head.theme, template: head.template, colorMode: head.colorMode }, title: head.title, description: head.description },
    { source: change(head.markup!), ...(metadata ? { metadata } : {}) },
  );
  const answer = await backend.commitEdit({ edit_id: head.edit_id, document_update: update });
  return { head, update, answer };
}

/** The server's reference model for the same committed update. */
const serverResult = (before: DocumentGraph, version: number, update: DocumentUpdate) =>
  documentAfterOperation(before, {
    kind: 'operations', version: version + 1, forward: update.patch, replacement: update.replacement ?? null,
    beforeNodes: {}, beforeRevisions: {}, beforeBytes: before.bytes,
  });

describe('what the file cannot do', () => {
  it('is offline and names a reason for every feature that needs artifactbin', () => {
    const { backend } = open();
    expect(backend.mode).toBe('offline');
    const expected: Record<BackendFeature, string> = {
      runQueries: OFFLINE_QUERY_REASON,
      webAssets: OFFLINE_ASSET_REASON,
      versions: 'Version history lives on artifactbin. Open the live version.',
      mentions: 'Mentions need a connection.',
      commentImages: 'Screenshots need a connection.',
      remoteSessions: 'Agents need a connection.',
      live: OFFLINE_REASONS.live,
    };
    for (const [feature, reason] of Object.entries(expected)) expect(backend.unavailable(feature as BackendFeature)).toBe(reason);
    expect(OFFLINE_REASONS.live).toBeTruthy();
  });

  it('rejects every request whose control is disabled, with that control’s reason', async () => {
    const { backend } = open();
    await expect(backend.queryTable('Ds1a2b', { sql: 'select 1', limit: 1, offset: 0 })).rejects.toThrow(OFFLINE_QUERY_REASON);
    await expect(backend.importImage({ imageUrl: 'https://example.com/a.png' })).rejects.toThrow(OFFLINE_ASSET_REASON);
    await expect(backend.versions()).rejects.toThrow(/Version history lives on artifactbin/);
    await expect(backend.version(1)).rejects.toThrow(/Version history lives on artifactbin/);
    await expect(backend.revert({ version: 1, expectedVersion: 1, expectedState: 's' })).rejects.toThrow(/Version history lives on artifactbin/);
    await expect(backend.remoteSessions()).rejects.toThrow('Agents need a connection.');
    await expect(backend.deleteRemoteSession('s1')).rejects.toThrow('Agents need a connection.');
    await expect(backend.uploadCommentImage(new FormData())).rejects.toThrow('Screenshots need a connection.');
  });

  it('knows nobody to mention and has nothing live to say', async () => {
    const { backend } = open();
    expect(await backend.members()).toEqual({ mentions: {} });
    expect(await backend.members('as')).toEqual({ people: [] });
    const stop = backend.live({ onPing: vi.fn(), onData: vi.fn(), onAnnotations: vi.fn() });
    expect(typeof stop).toBe('function');
    stop();
    expect(await backend.liveFrame()).toBeNull();
  });
});

describe('load', () => {
  it('is the file’s document, as the editor loads a head', async () => {
    const file = fixture();
    const head = (await open(file).backend.load())!;
    expect(head.id).toBe(file.artifactId);
    expect(head.markup).toBe(file.source);
    expect(graphSource(head.document!)).toBe(file.source);
    expect(head.version).toBe(file.base.version);
    expect(head.edit_id).toBeTruthy();
    expect(head.title).toBe(file.metadata.title);
    expect(head.template).toBe(file.metadata.template);
    expect(head).toMatchObject({ compiledCss: file.css.compiled, dataflow: { flow: file.island.dataflow!.flow, state: file.snapshot.state } });
  });

  it('counts a saved file’s edits into its version', async () => {
    const file = { ...fixture(), journal: [{ at: '2026-09-26T11:00:00.000Z', by: 'Asha', summary: 'Edited text' }] };
    expect((await open(file).backend.load())!.version).toBe(file.base.version + 1);
  });
});

describe('commitEdit — applied exactly as the server applies it', () => {
  it('a text edit', async () => {
    const { backend, latest, onChange } = open();
    const { head, update, answer } = await edit(backend, (s) => s.replace('>Regional sales</h1>', '>Q3 sales</h1>'));
    expect(answer.ok).toBe(true);
    expect(answer.status).toBe(200);
    const expected = serverResult(head.document!, head.version, update);
    expect(answer.body.markup).toBe(graphSource(expected));
    expect(answer.body.markup).toContain('>Q3 sales</h1>');
    expect(graphSource(answer.body.document!)).toBe(graphSource(expected));
    expect(answer.body.version).toBe(head.version + 1);
    expect(answer.body.edit_id).not.toBe(head.edit_id);
    expect(onChange).toHaveBeenCalledOnce();
    const file = latest();
    expect(file.source).toBe(answer.body.markup);
    expect(file.base.source).toBe(fixture().base.source);
    expect(JSON.stringify(file.island.nodes)).toContain('Q3 sales');
    expect(file.journal).toEqual([{ at: expect.any(String), by: 'Asha', summary: "Edited text in 'Q3 sales'" }]);
    // The next load continues from this edit.
    expect((await backend.load())!).toMatchObject({ markup: file.source, version: head.version + 1, edit_id: answer.body.edit_id });
  });

  it('an insert and a delete', async () => {
    const { backend, latest } = open();
    const inserted = await edit(backend, (s) => s.replace('<h1 ', '<p className="text-red-600">A new line</p>\n  <h1 '));
    expect(inserted.answer.ok).toBe(true);
    expect(inserted.answer.body.markup).toBe(graphSource(serverResult(inserted.head.document!, inserted.head.version, inserted.update)));
    expect(inserted.answer.body.markup).toContain('A new line');
    // A new utility class recompiles the file's compiled sheet.
    expect(inserted.update.effects.css).toBe(true);
    expect(latest().css.compiled).toContain('text-red-600');
    expect(fixture().css.compiled).not.toContain('text-red-600');
    expect(latest().journal.at(-1)).toMatchObject({ by: 'Asha', summary: expect.stringMatching(/^Added content/) });

    const removed = await edit(backend, (s) => s.replace(/\s*<p className="text-red-600"[^>]*>A new line<\/p>/, ''));
    expect(removed.answer.ok).toBe(true);
    expect(removed.answer.body.markup).toBe(graphSource(serverResult(removed.head.document!, removed.head.version, removed.update)));
    expect(removed.answer.body.markup).not.toContain('A new line');
    expect(latest().journal).toHaveLength(2);
    expect(latest().journal[1]).toMatchObject({ summary: expect.stringMatching(/^Removed content/) });
  });

  it('a rename is metadata and says so in the journal', async () => {
    const { backend, latest } = open();
    const { answer } = await edit(backend, (s) => s, { title: 'Q3 dashboard' });
    expect(answer.ok).toBe(true);
    expect(answer.body.title).toBe('Q3 dashboard');
    expect(latest().metadata.title).toBe('Q3 dashboard');
    expect(latest().journal.at(-1)!.summary).toBe("Renamed to 'Q3 dashboard'");
  });

  it('an edit by someone who picked no name is by "Someone"', async () => {
    const { backend, latest } = open(fixture(), null);
    await edit(backend, (s) => s.replace('>Regional sales</h1>', '>Sales</h1>'));
    expect(latest().journal[0]!.by).toBe('Someone');
  });

  it('answers an empty change and a stale conflict the way /edits does', async () => {
    const { backend, onChange } = open();
    const head = (await backend.load())!;
    const meta = { title: head.title, theme: head.theme, template: head.template, colorMode: head.colorMode };
    const empty = prepareClientDocumentUpdate({ document: head.document!, version: head.version, meta }, { source: head.markup! });
    expect(await backend.commitEdit({ edit_id: head.edit_id, document_update: empty })).toEqual({ ok: false, status: 400, body: { error: 'bad_diff', detail: 'identical' } });
    // Two edits prepared from the same head, both to the heading: the second is stale.
    const base = { document: head.document!, version: head.version, meta };
    const first = prepareClientDocumentUpdate(base, { source: head.markup!.replace('>Regional sales</h1>', '>One</h1>') });
    const second = prepareClientDocumentUpdate(base, { source: head.markup!.replace('>Regional sales</h1>', '>Two</h1>') });
    expect((await backend.commitEdit({ edit_id: head.edit_id, document_update: first })).ok).toBe(true);
    const conflict = await backend.commitEdit({ edit_id: head.edit_id, document_update: second });
    const now = (await backend.load())!;
    expect(conflict).toEqual({ ok: false, status: 409, body: { error: 'doc_changed', edit_id: now.edit_id, source: now.markup, version: now.version } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('keeps every image the file inlined when an edit rebuilds the island', async () => {
    const source = '<main id="m1"><h2 id="h1">Photos</h2><img id="i1" src="https://example.com/a.png" alt="A" /><p id="p1">Caption</p></main>';
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const nodes = JSON.parse(JSON.stringify(storyUpdateParts(source, isWebUrl)!.nodes).replace(/\/assets\/[0-9a-f]{64}/g, png));
    const base = fixture();
    const file: ArtifactFile = { ...base, source, base: { ...base.base, source }, island: { ...base.island, nodes, dataflow: undefined } };
    const { backend, latest } = open(file);
    expect((await edit(backend, (s) => s.replace('Caption', 'A caption'))).answer.ok).toBe(true);
    const island = JSON.stringify(latest().island.nodes);
    expect(island).toContain(png);
    expect(island).toContain('A caption');
    expect(island).not.toContain('/assets/');
    // And the frame the editor pushes (every web URL at its /assets/ address) gets the same bytes back.
    const pushed = { type: 'mx:document', nodes: storyUpdateParts(latest().source, isWebUrl)!.nodes };
    expect(JSON.stringify(pushed)).toMatch(/\/assets\/[0-9a-f]{64}/);
    const inlined = JSON.stringify(fileAssetInliner(file)(pushed));
    expect(inlined).toContain(png);
    expect(inlined).not.toContain('/assets/');
  });
});

describe('prepare — what an edit needs from artifactbin', () => {
  it('answers as a no-op context for what the file already has', async () => {
    const { backend } = open();
    const source = fixture().source;
    await expect(backend.prepare(source)).resolves.toEqual({});
    await expect(backend.prepare('<p id="n1">Plain words</p>')).resolves.toEqual({});
  });

  it.each([
    ['a new web image', '<img src="https://example.com/new.png" alt="new" />'],
    ['a new icon', '<Icon name="calendar" />'],
    ['a new query source binding', '<Helmet><Import name="more_data" src="ref:Zz9Zz9" /><Query name="more">{`select 1`}</Query></Helmet>'],
    ['a ref: target that is not in the file', '<Image src="ref:Qq1Qq1" alt="x" />'],
  ])('refuses %s with the asset reason', async (_label, source) => {
    const { backend } = open();
    await expect(backend.prepare(source)).rejects.toThrow(OFFLINE_ASSET_REASON);
  });
});

describe('drafts: CSS and queries', () => {
  it('compiles a draft’s stylesheet in the file', async () => {
    const { css } = await open().backend.previewCss('<p id="x" className="text-emerald-700 underline">Hi</p>');
    expect(css).toContain('text-emerald-700');
  });

  it('answers unchanged queries from the snapshot and refuses new or changed ones', async () => {
    const file = fixture();
    const { backend } = open(file);
    const same = await backend.previewQueries(file.source);
    expect(same!.tables.sales).toEqual(file.snapshot.state.tables.sales);
    const changed = await backend.previewQueries(file.source.replace('order by 1, 2', 'order by 2'));
    expect(changed!.tables.sales).toBeUndefined();
    expect(changed!.errors.sales).toBe(OFFLINE_QUERY_REASON);
    expect(changed!.tables.regions).toEqual(file.snapshot.state.tables.regions);
  });

  it('serves the runtime from the snapshot over the CURRENT declarations', async () => {
    const file = fixture();
    const { backend } = open(file);
    const transport = backend.queryTransport();
    const values = file.snapshot.state.values;
    expect((await transport.run(values, ['sales'])).tables.sales).toEqual(file.snapshot.state.tables.sales);
    await edit(backend, (s) => s.replace('order by 1, 2', 'order by 2'));
    const after = await transport.run(values, ['sales', 'regions']);
    expect(after.errors.sales).toBe(OFFLINE_QUERY_REASON);
    expect(after.tables.regions).toEqual(file.snapshot.state.tables.regions);
    transport.dispose();
  });
});

describe('comments in the file', () => {
  const headingId = (file: ArtifactFile) => /<h1 [^>]*id="([^"]+)"/.exec(file.source)![1]!;
  /** The heading's BODY path: the Helmet is hoisted out of the body, and the text between elements counts. */
  const HEADING_PATH = '1.1';

  it('starts a thread under the picked name, anchored to the node, and keeps it in the file', async () => {
    const file = fixture();
    const { backend, latest } = open(file);
    const nodeId = headingId(file);
    const wire = await backend.createAnnotation({ path: '0.0', node_id: nodeId, body: 'Is this the right title?', quote: 'Regional' }, 'key-1');
    expect(wire.id).toMatch(/^local-/);
    expect(wire).toMatchObject({
      status: 'open', orphaned: false, quote: 'Regional', quote_found: true,
      anchor: { key: nodeId, nodeId, path: HEADING_PATH },
      thread: [{ id: wire.id, body: 'Is this the right title?', author: { kind: 'human', label: 'Asha', transport: 'browser', user_id: null, image: null } }],
    });
    expect(wire.snippet).toBe('Regional sales');
    expect(latest().threads).toContainEqual(wire);
    expect(latest().localIds).toEqual([wire.id]);
    // The same request again (a retry) is the same comment.
    expect(await backend.createAnnotation({ path: '0.0', node_id: nodeId, body: 'Is this the right title?' }, 'key-1')).toEqual(wire);
    expect(latest().threads).toHaveLength(1);
    await expect(backend.createAnnotation({ path: '0.0', node_id: 'nope', body: 'x' }, 'key-2')).rejects.toBeInstanceOf(BackendRequestError);
  });

  it('replies, resolves and reopens, and lists by status', async () => {
    const file = fixture();
    const { backend, latest, onChange } = open(file);
    const wire = await backend.createAnnotation({ path: '0.0', node_id: headingId(file), body: 'Title?' }, 'k');
    const replied = await backend.actOnAnnotation(wire.id, { reply: 'Looks right' });
    expect(replied.thread).toHaveLength(2);
    expect(replied.thread[1]).toMatchObject({ body: 'Looks right', author: { label: 'Asha' } });
    expect(latest().localIds).toEqual([wire.id, replied.thread[1]!.id]);
    const resolved = await backend.actOnAnnotation(wire.id, { resolve: true });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_at).toBeTruthy();
    expect(await backend.listAnnotations('open')).toEqual([]);
    // No status is the open list, as GET /annotations answers it.
    expect(await backend.listAnnotations()).toEqual([]);
    expect((await backend.listAnnotations('resolved')).map((t) => t.id)).toEqual([wire.id]);
    const reopened = await backend.actOnAnnotation(wire.id, { reopen: true });
    expect(reopened).toMatchObject({ status: 'open', resolved_at: null });
    expect((await backend.listAnnotations()).map((t) => t.id)).toEqual([wire.id]);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('re-anchors threads to the document as edited', async () => {
    const file = fixture();
    const { backend } = open(file);
    const wire = await backend.createAnnotation({ path: HEADING_PATH, node_id: headingId(file), body: 'Title?' }, 'k');
    expect(wire.anchor!.path).toBe(HEADING_PATH);
    await edit(backend, (s) => s.replace('<h1 ', '<p id="zz01">Before</p>\n  <h1 '));
    const [thread] = await backend.listAnnotations();
    expect(thread!.id).toBe(wire.id);
    // The new paragraph and the line break after it sit before the heading now.
    expect(thread!.anchor!.path).toBe('1.3');
    await edit(backend, (s) => s.replace(/<h1 [^>]*>Regional sales<\/h1>/, ''));
    const [orphan] = await backend.listAnnotations();
    expect(orphan).toMatchObject({ orphaned: true, anchor: null, snippet: 'Regional sales' });
  });

  it('deletes only what was written in a file', async () => {
    const file = { ...fixture(), threads: [{
      id: 'ann_server', status: 'open' as const, anchor: null, orphaned: true, anchor_version: 1, snippet: 's', quote: null, range: null, quote_found: null,
      thread: [{ id: 'ann_server', body: 'from the site', author: { kind: 'human' as const, label: 'Ravi', transport: 'browser' as const, user_id: 'u1', image: null }, created_at: '2026-09-25T00:00:00.000Z' }],
      created_at: '2026-09-25T00:00:00.000Z', resolved_at: null,
    }] };
    const { backend, latest } = open(file);
    await expect(backend.deleteAnnotation('ann_server')).rejects.toThrow(LOCAL_DELETE_ONLY);
    const mine = await backend.createAnnotation({ path: '0.0', node_id: headingId(file), body: 'Mine' }, 'k');
    const reply = (await backend.actOnAnnotation('ann_server', { reply: 'A reply here' })).thread[1]!;
    await backend.deleteAnnotation(reply.id);
    expect(latest().threads.find((t) => t.id === 'ann_server')!.thread).toHaveLength(1);
    await backend.deleteAnnotation(mine.id);
    expect(latest().threads.map((t) => t.id)).toEqual(['ann_server']);
    expect(latest().localIds).toEqual([]);
    expect(LOCAL_DELETE_ONLY).toBe('Only comments made in this file can be deleted here.');
  });
});

describe('a source changed outside the file', () => {
  const headingId = (file: ArtifactFile) => /<h1 [^>]*id="([^"]+)"/.exec(file.source)![1]!;
  const HEADING_PATH = '1.1';
  /** What an agent does: change the top-level source and nothing else. */
  const changed = (edit: (source: string) => string, file = fixture()): ArtifactFile => ({ ...file, source: edit(file.source) });
  const texts = (file: ArtifactFile) => JSON.stringify(file.island.nodes);

  it('is noticed by the digest of the source the rest was built from', () => {
    const file = fixture();
    expect(file.derivedFrom).toBe(sourceDigest(file.source));
    expect(sourceChangedOutside(file)).toBe(false);
    expect(sourceChangedOutside(changed((s) => s.replace('Regional sales</h1>', 'Quarterly sales</h1>')))).toBe(true);
    // A file that records no digest is trusted as it is.
    expect(sourceChangedOutside({ ...changed((s) => `${s} `), derivedFrom: undefined })).toBe(false);
    expect(sourceDigest('a')).not.toBe(sourceDigest('b'));
    expect(sourceDigest('<p>é</p>')).toBe(sourceDigest('<p>é</p>'));
  });

  it('leaves an unchanged file alone', async () => {
    const file = fixture();
    expect(await rebuildArtifactFile(file)).toEqual({ file, rebuilt: false, error: null });
  });

  it('is rebuilt as a commit rebuilds it: island, stylesheet, digest, and a journal line', async () => {
    const before = fixture();
    const file = changed((s) => s.replace('Regional sales</h1>', 'Quarterly sales</h1>').replace('<Button run', '<p className="text-pink-700">Added by an agent</p>\n  <Button run'), before);
    const { file: after, rebuilt, error } = await rebuildArtifactFile(file, 'Asha');
    expect(error).toBeNull();
    expect(rebuilt).toBe(true);
    expect(texts(after)).toContain('Quarterly sales');
    expect(texts(after)).toContain('Added by an agent');
    expect(texts(after)).not.toContain('Regional sales</h1>');
    // The new paragraph got a node id, as publish stamps one; the heading kept its own.
    expect(after.source).toMatch(/<p className="text-pink-700" id="[A-Za-z][A-Za-z0-9]{3}">Added by an agent<\/p>/);
    expect(after.source).toContain(`id="${headingId(before)}">Quarterly sales</h1>`);
    expect(after.css.compiled).toContain('text-pink-700');
    expect(after.derivedFrom).toBe(sourceDigest(after.source));
    expect(sourceChangedOutside(after)).toBe(false);
    expect(after.journal).toEqual([{ at: expect.any(String), by: 'Asha', summary: CHANGED_OUTSIDE }]);
    expect(CHANGED_OUTSIDE).toBe('Changed outside the file');
    // What the download ran is untouched.
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.base).toEqual(before.base);
  });

  it('keeps a thread anchored to a node the outside edit kept', async () => {
    const file = fixture();
    const { backend, latest } = open(file);
    const wire = await backend.createAnnotation({ path: HEADING_PATH, node_id: headingId(file), body: 'Title?' }, 'k');
    const { file: after } = await rebuildArtifactFile(changed((s) => s.replace('Regional sales</h1>', 'Quarterly sales</h1>'), latest()));
    const [thread] = await open(after).backend.listAnnotations();
    expect(thread).toMatchObject({ id: wire.id, orphaned: false, snippet: 'Quarterly sales' });
  });

  it('is then edited and saved like any other file', async () => {
    const { file: after } = await rebuildArtifactFile(changed((s) => s.replace('Regional sales</h1>', 'Quarterly sales</h1>')));
    const { backend, latest } = open(after);
    const { answer } = await edit(backend, (s) => s.replace('Quarterly sales</h1>', 'Yearly sales</h1>'));
    expect(answer.ok).toBe(true);
    expect(latest().journal.map((e) => e.summary)).toEqual([CHANGED_OUTSIDE, "Edited text in 'Yearly sales'"]);
    expect(latest().derivedFrom).toBe(sourceDigest(latest().source));
  });

  it('keeps the last good file and names the validator\'s reason for invalid markup', async () => {
    const file = changed((s) => s.replace('<Button run', '<p>{$missing}</p>\n  <Button run'));
    const result = await rebuildArtifactFile(file);
    expect(result.rebuilt).toBe(false);
    expect(result.file).toBe(file);
    expect(result.error).toMatch(/\$missing.* refers to nothing declared/);
  });

  it('survives markup that does not parse: the reason, and a backend that says it cannot edit', async () => {
    const file = changed((s) => s.replace('<h1 ', '<h1 <<'));
    const result = await rebuildArtifactFile(file);
    expect(result.rebuilt).toBe(false);
    expect(result.error).toBeTruthy();
    const { backend } = open(file);
    await expect(backend.load()).rejects.toBeInstanceOf(BackendRequestError);
    expect(await backend.listAnnotations()).toEqual([]);
  });

  it('never answers a query the agent changed with the rows the download ran for the old SQL', async () => {
    const file = changed((s) => s.replace('select region, month, revenue from public.rows where', 'select region, month, revenue * 2 as revenue from public.rows where'));
    const { file: after, error } = await rebuildArtifactFile(file);
    expect(error).toBeNull();
    const { backend } = open(after);
    const answered = await backend.queryTransport().run({ region: null, note: null }, ['sales', 'regions']);
    expect(answered.tables.sales).toBeUndefined();
    expect(answered.errors.sales).toBe(OFFLINE_QUERY_REASON);
    expect(answered.tables.regions).toEqual(after.snapshot.state.tables.regions);
    // What the page seeds the runtime with says the same before any query runs.
    const seeded = snapshotStateFor(after);
    expect(seeded.tables.sales).toBeUndefined();
    expect(seeded.errors.sales).toBe(OFFLINE_QUERY_REASON);
    expect(seeded.tables.regions).toEqual(after.snapshot.state.tables.regions);
    expect(snapshotStateFor(fixture())).toEqual(fixture().snapshot.state);
  });

  it('refuses what needs artifactbin, as a commit in the file does', async () => {
    const result = await rebuildArtifactFile(changed((s) => s.replace('<Button run', '<img src="https://example.com/new.png" alt="" />\n  <Button run')));
    expect(result).toMatchObject({ rebuilt: false, error: OFFLINE_ASSET_REASON });
  });
});
