import {describe,expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {operationHttp} from './operation-http';
useAppHarness();
describe('advanced HTTP parity',()=>{
  it('create → get → update round-trips a markup artifact with refs, token-scoped', async () => {
    const t = await mintToken('t');
    const ds = await operationHttp(t.token, 'create_artifact', { title: 'sales', dataset: [{ m: 'Jan', v: 1 }, { m: 'Feb', v: 2 }] });
    expect(ds.isError).toBe(false);
    expect(ds.data.columns).toEqual([{ name: 'm', type: 'string' }, { name: 'v', type: 'number' }]);

    const story = await operationHttp(t.token, 'create_artifact', {
      title: 'story',
      markup: `<Helmet><Query name="rows" source="ref:${ds.data.id}">{\`select * from public.rows\`}</Query></Helmet><div data-design="tw"><Question data="$rows" viz={{kind:"table"}} height="200px" /></div>`,
    });
    expect(story.isError).toBe(false);
    // One URL per artifact, addressed by the one identifier: /a/<id> is the
    // only link (editing is a mode on it), and there is no second name.
    expect(story.data.url).toBe(`http://localhost:3000/a/${story.data.id}`);
    expect(story.data).not.toHaveProperty('slug');
    expect(story.data).not.toHaveProperty('editUrl');

    const got = await operationHttp(t.token, 'get_artifact', { id: story.data.id as string });
    expect(got.data.refs).toEqual([{ id: ds.data.id, kind: 'dataset' }]);

    const updated = await operationHttp(t.token, 'update_artifact', {
      id: story.data.id as string,
      markup: `<Helmet><Query name="rows" source="ref:${ds.data.id}">{\`select * from public.rows\`}</Query></Helmet><div data-design="tw"><h1 className="text-2xl">v2</h1><Question data="$rows" viz={{kind:"table"}} height="200px" /></div>`,
      theme: 'terminal',
    });
    expect(updated.isError).toBe(false);
    expect(updated.data.version).toBe(2);

    // Protocol permutations formerly repeated in the broad browser smoke.
    const id = story.data.id as string;
    const listed = await operationHttp(t.token, 'list_artifacts', {});
    expect(listed.isError).toBe(false);
    expect(listed.data.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    const versions = await operationHttp(t.token, 'list_versions', { id });
    expect(versions.isError).toBe(false);
    expect(versions.data.versions).toHaveLength(2);
    const original = await operationHttp(t.token, 'get_version', { id, version: 1 });
    expect(original.isError).toBe(false);
    const reverted = await operationHttp(t.token, 'revert_artifact', { id, version: 1 });
    expect(reverted.isError).toBe(false);
    expect(reverted.data.version).toBe(3);

    // Another token can read this public document but cannot edit it.
    const other = await mintToken('other');
    const denied = await operationHttp(other.token, 'get_artifact', { id: story.data.id as string });
    expect(denied.isError).toBe(false);expect(denied.data.capabilities).toMatchObject({read:true,edit:false});
    const deleted = await operationHttp(t.token, 'delete_artifact', { id });
    expect(deleted.isError).toBe(false);
    expect(deleted.data.ok).toBe(true);
    expect((await operationHttp(t.token, 'get_artifact', { id })).isError).toBe(true);
  });

  /**
   * FORK over HTTP, end to end and on the branch production takes (the proxy
   * vouched for the bearer and attached the actor). The reach is READ, so the
   * forker is a different token entirely — and the copy is its own.
   */
  it('fork_artifact copies a public document as the CALLING token, create-shaped plus forked_from', async () => {
    const owner = await mintToken('owner');
    const doc = await operationHttp(owner.token, 'create_artifact', {
      title: 'Payroll', visibility: 'public',
      markup: '<div data-design="tw"><h1 className="text-2xl">Payroll</h1></div>',
    });
    expect(doc.isError).toBe(false);

    const forker = await mintToken('forker');
    const copy = await operationHttp(forker.token, 'fork_artifact', { id: doc.data.id as string, title: 'My copy' });
    expect(copy.isError, JSON.stringify(copy.data)).toBe(false);
    expect(copy.data.id).not.toBe(doc.data.id);
    expect(copy.data.forked_from).toBe(doc.data.id);
    expect(copy.data.version).toBe(1);
    expect(copy.data.title).toBe('My copy');
    expect(String(copy.data.markup)).toContain('Payroll');
    // The copy is the FORKER's — and the original is untouched for its owner.
    const mine = await operationHttp(forker.token, 'list_artifacts', {});
    expect((mine.data.artifacts as Array<{ id: string }>).map((a) => a.id)).toEqual([copy.data.id]);
    const theirs = await operationHttp(owner.token, 'get_artifact', { id: doc.data.id as string });
    expect(theirs.data.title).toBe('Payroll');
    expect(theirs.data.version).toBe(1);
  });

  it('fork_artifact answers the uniform not_found for what the token cannot read', async () => {
    const owner = await mintToken('owner');
    const doc = await operationHttp(owner.token, 'create_artifact', { markup: '<p>secret</p>', visibility: 'unlisted' });
    const stranger = await mintToken('stranger');
    // Unlisted reads by link, so the refusal is proved on an id that exists nowhere.
    expect((await operationHttp(stranger.token, 'fork_artifact', { id: 'zzzzzz' })).data.error).toBe('not_found');
    expect((await operationHttp(stranger.token, 'fork_artifact', { id: doc.data.id as string })).isError).toBe(false);
  });

  it('a retired theme is a real HTTP result carrying the successor hint, not a schema error', async () => {
    const t = await mintToken('t');
    // The zod schema deliberately does NOT enum the theme: a retired name must
    // reach the publish pipeline, whose 400 names the successor — an agent's
    // only route out. A schema enum would answer with a generic zod error.
    const res = await operationHttp(t.token, 'create_artifact', { markup: '<p>x</p>', theme: 'nocturne' });
    expect(res.isError).toBe(true);
    expect(res.data.error).toBe('retired_theme');
    expect(String(res.data.hint)).toContain('modernist');
  });

  it('edit_artifact speaks the concurrent-edit protocol: accept, then doc_changed with head to rebase on', async () => {
    const t = await mintToken('t');
    const doc = await operationHttp(t.token, 'create_artifact', { title: 's', markup: '<section><p>alpha text</p><p>beta text</p></section>' });
    expect(doc.isError).toBe(false);
    expect(doc.data.edit_id).toMatch(/^[a-f0-9]{32}$/);

    const first = await operationHttp(t.token, 'edit_artifact', {
      id: doc.data.id, edit_id: doc.data.edit_id, old_string: 'alpha text', new_string: 'ALPHA',
    });
    expect(first.isError).toBe(false);
    expect(first.data.edit_id).not.toBe(doc.data.edit_id);

    const clash = await operationHttp(t.token, 'edit_artifact', {
      id: doc.data.id, edit_id: doc.data.edit_id, old_string: 'alpha', new_string: 'x',
    });
    expect(clash.isError).toBe(true);
    expect(clash.data.error).toBe('doc_changed');
    expect(clash.data.edit_id).toBe(first.data.edit_id);
    expect(clash.data.source).toContain('ALPHA');
  });

  it('surfaces validation diagnostics through HTTP errors', async () => {
    const t = await mintToken('t');
    const bad = await operationHttp(t.token, 'create_artifact', { title: 'x', markup: '<Bogus>nope</Bogus>' });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.data)).toContain('Bogus');
  });

  it('dataset refresh warns about broken dependents (never blocks)', async () => {
    const t = await mintToken('t');
    const ds = await operationHttp(t.token, 'create_artifact', { title: 'sales', dataset: [{ m: 'Jan', v: 1 }] });
    const story = await operationHttp(t.token, 'create_artifact', {
      title: 'story',
      markup: `<Helmet><Query name="rows" source="ref:${ds.data.id}">{\`select * from public.rows\`}</Query></Helmet><div data-design="tw"><Question data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{y:{field:"v", type:"quantitative"}}}}} height="200px" /></div>`,
    });
    const refreshed = await operationHttp(t.token, 'update_artifact', { id: ds.data.id as string, dataset: [{ m: 'Jan', other: 9 }] });
    expect(refreshed.isError).toBe(false);
    expect(JSON.stringify(refreshed.data.warnings)).toContain(story.data.id);
  });
});
describe('HTTP optimistic concurrency', () => {
  it('update_artifact with a stale expectedVersion reports version_conflict; replay converges', async () => {
    const t = await mintToken('agent');
    const created = await operationHttp(t.token, 'create_artifact', { markup: '<h1 className="text-2xl">v1</h1>' });
    expect(created.isError).toBe(false);
    const id = created.data.id as string;

    // A concurrent editor bumps the head (v1 → v2).
    const other = await operationHttp(t.token, 'update_artifact', { id, markup: '<h1 className="text-2xl">other</h1>' });
    expect(other.data.version).toBe(2);

    // This agent still holds v1 — the guarded update must conflict, not clobber.
    const stale = await operationHttp(t.token, 'update_artifact', { id, markup: '<h1 className="text-2xl">mine</h1>', expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.data.error).toBe('version_conflict');
    expect(stale.data.currentVersion).toBe(2);

    // Replay at the reported head converges.
    const replay = await operationHttp(t.token, 'update_artifact', { id, markup: '<h1 className="text-2xl">mine</h1>', expectedVersion: 2 });
    expect(replay.isError).toBe(false);
    expect(replay.data.version).toBe(3);
  });
});
