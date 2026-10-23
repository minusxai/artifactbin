import {getArtifactById} from '@/lib/artifacts';
import {nativeHtml} from '@/__tests__/native-html-fixture';
import {describe,expect,it} from 'vitest';
import {useAppHarness} from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {operationHttp} from './operation-http';
useAppHarness();
describe('advanced HTTP parity',()=>{
  it('create → get → update round-trips a native page with dataset bindings, token-scoped', async () => {
    const t = await mintToken('t');
    const ds = await operationHttp(t.token, 'create_artifact', { title: 'sales', dataset: [{ m: 'Jan', v: 1 }, { m: 'Feb', v: 2 }] });
    expect(ds.isError).toBe(false);
    expect(ds.data.columns).toEqual([{ name: 'm', type: 'string' }, { name: 'v', type: 'number' }]);

    const story = await operationHttp(t.token, 'create_artifact', {
      title: 'story', visibility: 'public',
      html:nativeHtml(`<link rel="af-dataset" data-af-name="rows_data" href="ref:${ds.data.id}"><h1>Dataset page</h1>`),
    });
    expect(story.isError).toBe(false);
    // One URL per artifact, addressed by the one identifier: /a/<id> is the
    // only link (editing is a mode on it), and there is no second name.
    expect(story.data.url).toBe(`http://localhost:3000/a/${story.data.id}`);
    expect(story.data).not.toHaveProperty('slug');
    expect(story.data).not.toHaveProperty('editUrl');

    const got = await operationHttp(t.token, 'get_artifact', { id: story.data.id as string });
    expect(got.data.html).toContain(`href="ref:${ds.data.id}"`);
    expect((await getArtifactById(String(story.data.id)))?.meta.htmlLinks).toEqual([{kind:'dataset',name:'rows_data',datasetId:ds.data.id,mode:'live'}]);

    const updated = await operationHttp(t.token, 'update_artifact', {
      id: story.data.id as string,
      html:nativeHtml(`<link rel="af-dataset" data-af-name="rows_data" href="ref:${ds.data.id}"><h1>v2</h1>`),
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
    const reverted = await operationHttp(t.token,'revert_artifact',{id,version:1});
    expect(reverted.isError).toBe(false);expect(reverted.data.version).toBe(3);

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
      html:nativeHtml('<div data-design="tw"><h1 className="text-2xl">Payroll</h1></div>'),
    });
    expect(doc.isError).toBe(false);

    const forker = await mintToken('forker');
    const copy = await operationHttp(forker.token, 'fork_artifact', { id: doc.data.id as string, title: 'My copy' });
    expect(copy.isError, JSON.stringify(copy.data)).toBe(false);
    expect(copy.data.id).not.toBe(doc.data.id);
    expect(copy.data.forked_from).toBe(doc.data.id);
    expect(copy.data.version).toBe(1);
    expect(copy.data.title).toBe('My copy');
    expect(String(copy.data.html)).toContain('Payroll');
    // The copy is the FORKER's — and the original is untouched for its owner.
    const mine = await operationHttp(forker.token, 'list_artifacts', {});
    expect((mine.data.artifacts as Array<{ id: string }>).map((a) => a.id)).toEqual([copy.data.id]);
    const theirs = await operationHttp(owner.token, 'get_artifact', { id: doc.data.id as string });
    expect(theirs.data.title).toBe('Payroll');
    expect(theirs.data.version).toBe(1);
  });

  it('fork_artifact answers the uniform not_found for what the token cannot read', async () => {
    const owner = await mintToken('owner');
    const doc = await operationHttp(owner.token, 'create_artifact', { html:nativeHtml('<p>secret</p>'), visibility: 'unlisted' });
    const stranger = await mintToken('stranger');
    // Unlisted reads by link, so the refusal is proved on an id that exists nowhere.
    expect((await operationHttp(stranger.token, 'fork_artifact', { id: 'zzzzzz' })).data.error).toBe('not_found');
    expect((await operationHttp(stranger.token, 'fork_artifact', { id: doc.data.id as string })).isError).toBe(false);
  });

  // JSX theme-name compilation was retired; native head/style roundtrips are covered by helmet-publish.
  it('surfaces validation diagnostics through HTTP errors', async () => {
    const t = await mintToken('t');
    const bad = await operationHttp(t.token, 'create_artifact', { title: 'x', html:nativeHtml('<p data-af-id="same">A</p><p data-af-id="same">B</p>') });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toBe('invalid_html');
  });

  it('a dataset replacement leaves its native consumer and immutable binding unchanged', async () => {
    const t=await mintToken('binding');
    const ds=await operationHttp(t.token,'create_artifact',{dataset:[{m:'Jan',v:1}]});
    const story=await operationHttp(t.token,'create_artifact',{html:nativeHtml(`<link rel="af-dataset" data-af-name="rows_data" href="ref:${ds.data.id}"><h1>Dataset page</h1>`)});
    expect(story.isError).toBe(false);
    const refreshed=await operationHttp(t.token,'update_artifact',{id:ds.data.id,dataset:[{m:'Jan',other:9}]});
    expect(refreshed.isError).toBe(false);
    const current=await operationHttp(t.token,'get_artifact',{id:story.data.id});
    expect(current.data.html).toBe(story.data.html);expect(current.data.version).toBe(1);
  });
});
describe('HTTP optimistic concurrency', () => {
  it('update_artifact with a stale expectedVersion reports doc_changed; replay converges', async () => {
    const t = await mintToken('agent');
    const created = await operationHttp(t.token, 'create_artifact', { html:nativeHtml('<h1 className="text-2xl">v1</h1>') });
    expect(created.isError).toBe(false);
    const id = created.data.id as string;

    // A concurrent editor bumps the head (v1 → v2).
    const other = await operationHttp(t.token, 'update_artifact', { id, html:nativeHtml('<h1 className="text-2xl">other</h1>') });
    expect(other.data.version).toBe(2);

    // This agent still holds v1 — the guarded update must conflict, not clobber.
    const stale = await operationHttp(t.token, 'update_artifact', { id, html:nativeHtml('<h1 className="text-2xl">mine</h1>'), expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.data.error).toBe('version_conflict');
    expect(stale.data.currentVersion).toBe(2);

    // Replay at the reported head converges.
    const replay = await operationHttp(t.token, 'update_artifact', { id, html:nativeHtml('<h1 className="text-2xl">mine</h1>'), expectedVersion: 2 });
    expect(replay.isError).toBe(false);
    expect(replay.data.version).toBe(3);
  });
});
