/**
 * READ ADMISSION, door by door: every door that serves a document's bytes admits the same callers. The matrix below is
 * each door's answer to each caller: `in` when it serves, `out` when it answers its uniform 404. The callers are the
 * ones the admission rule tells apart: a guest, a signed-in stranger, the owner, the holder of the token that created
 * the row (on a row an account owns, so the token is the only thing admitting it), and a signed export key for the
 * row or for another one. A door that disagrees with its siblings is a row of its own, named.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserService, RenderResult } from '@artifactbin/contracts/browser';
import { mintAccountToken, params, request, setSession, testPagesSite, useAppHarness, type RequestOptions } from '@/__tests__/harness';
import { EXPORT_PNG } from './export-helpers';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { GET as downloadRoute } from '@/app/a/[id]/download/route';
import { GET as fetchRoute } from '@/app/a/[id]/fetch/route';
import { GET as assetsRoute } from '@/app/a/[id]/assets/route';
import { POST as trustRoute } from '@/app/api/trust/route';
import { createUser, identityForUser } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { artifactPageResponse, framedDocumentSrc } from '@/lib/document-serving';
import { mintExportKey, resetExportRenderer } from '@/lib/export';
import { OPERATIONS } from '@/lib/operations/registry';
import { getDb, setServices } from '@/lib/platform';
import { createGroup } from '@/lib/groups';
import { setArtifact } from '@/__tests__/rows';

useAppHarness();
let session: string | null = null;
beforeEach(async () => {
  session = null;
  setSession(() => (session ? { user: { id: session } } : null));
  await resetExportRenderer();
  const png: RenderResult = { ok: true, mime: 'image/png', bytes: EXPORT_PNG };
  setServices({ browser: { async render() { return png; } } as BrowserService });
});
afterEach(async () => { await resetExportRenderer(); setServices({ browser: undefined }); });

type Caller = 'guest' | 'stranger' | 'owner' | 'creator' | 'key' | 'otherKey';
const CALLERS: Caller[] = ['guest', 'stranger', 'owner', 'creator', 'key', 'otherKey'];

async function world() {
  const owner = (await createUser({ email: 'mxmx_test_admission_owner@example.com' })).id;
  const stranger = (await createUser({ email: 'mxmx_test_admission_stranger@example.com' })).id;
  // The creating token is another account's: only the token clause can admit its holder to the owner's private row.
  const creator = await mintAccountToken('admission-agent');
  const html = await createArtifact(creator.id, owner, { format: 'html', title: 'Plan', source: '<!doctype html><p>secret</p>', meta: {}, visibility: 'private' });
  const dataset = await createArtifact(creator.id, owner, { format: 'dataset', title: 'Rows', source: '[{"a":1}]', meta: {}, visibility: 'private' });
  return { owner, stranger, creator, html: html.id, dataset: dataset.id };
}
type World = Awaited<ReturnType<typeof world>>;

/** The request a caller sends: its credential, and the export key in the query when it holds one. */
function as(w: World, caller: Caller, id: string, path: string, extra: RequestOptions = {}): Request {
  session = caller === 'stranger' ? w.stranger : caller === 'owner' ? w.owner : null;
  const key = caller === 'key' ? mintExportKey(id) : caller === 'otherKey' ? mintExportKey(id === w.html ? w.dataset : w.html) : null;
  const url = key ? `${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : path;
  // The creator's bearer as the proxy attaches it: the session doors and the request doors both see it.
  return request(url, { ...extra, ...(caller === 'creator' ? { actor: { credential: 'bearer', userId: w.creator.userId!, tokenId: w.creator.id, ...(w.creator.email ? { email: w.creator.email } : {}) } } : {}) });
}
const actorOf = (w: World, caller: Caller) =>
  caller === 'creator' ? identityForUser(w.creator.userId, w.creator.id) : identityForUser(caller === 'owner' ? w.owner : caller === 'stranger' ? w.stranger : null, null);

const site = testPagesSite('pages.example.test', 'http://localhost:3000');
const refused = (status: number) => status === 404;
type Door = (w: World, caller: Caller, id: string) => Promise<boolean>;
const DOORS: Record<string, Door> = {
  page: async (w, c, id) => !refused((await artifactPageResponse(as(w, c, id, `/a/${id}`), id)).status),
  frame: async (w, c, id) => (await framedDocumentSrc(as(w, c, id, `/api/page/frame/${id}`), id, site)) !== null,
  raw: async (w, c, id) => !refused((await rawRoute(as(w, c, id, `/a/${id}/raw`), params({ id }))).status),
  assets: async (w, c, id) => !refused((await assetsRoute(as(w, c, id, `/a/${id}/assets?u=${encodeURIComponent("http://127.0.0.1/x.png")}`), params({ id }))).status),
  download: async (w, c, id) => !refused((await downloadRoute(as(w, c, id, `/a/${id}/download`), params({ id }))).status),
  fetch: async (w, c, id) => !refused((await fetchRoute(as(w, c, id, `/a/${id}/fetch`), params({ id }))).status),
  trust: async (w, c, id) => !refused((await trustRoute(as(w, c, id, '/api/trust', { method: 'POST', origin: 'same', json: { artifactId: id, grant: 'once' } }))).status),
  export: async (w, c, id) => !refused((await exportRoute(as(w, c, id, `/a/${id}/export`), params({ id }))).status),
  exportOperation: async (w, c, id) => {
    const op = OPERATIONS.find(o => o.name === 'export_artifact')!;
    const req = as(w, c, id, `/api/artifacts/${id}/export`);
    return !refused((await op.run({ actor: actorOf(w, c), base: 'http://localhost:3000', request: req, author: { kind: 'agent', label: 'test', transport: 'mcp' } }, { id })).status);
  },
  // A dry run answers what a fork would copy, after the same read admission a real fork asks.
  forkOperation: async (w, c, id) => {
    const op = OPERATIONS.find(o => o.name === 'fork_artifact')!;
    const req = as(w, c, id, `/api/artifacts/${id}/fork`);
    return !refused((await op.run({ actor: actorOf(w, c), base: 'http://localhost:3000', request: req, author: { kind: 'agent', label: 'test', transport: 'mcp' } }, { id, dry_run: true })).status);
  },
};

/** Each door's admitted callers, in CALLERS order. One caller at a time: a direct handler call's session is this file's one variable. */
async function matrix(w: World, id: string, doors: string[] = Object.keys(DOORS)): Promise<Record<string, string>> {
  const seen: Record<string, string> = {};
  for (const door of doors) {
    const admitted: Caller[] = [];
    for (const caller of CALLERS) if (await DOORS[door]!(w, caller, id)) admitted.push(caller);
    seen[door] = admitted.join(' ');
  }
  return seen;
}

describe('read admission across the doors', () => {
  it('an HTML page: every door admits the owner and the creating token, the keyed doors the key, nobody else', async () => {
    const w = await world();
    expect(await matrix(w, w.html)).toEqual({
      page: 'owner creator key',
      frame: 'owner creator',
      raw: 'owner creator key',
      assets: 'owner creator key',
      // The door admits the creating token, but the page's bundled files load under the rule alone
      // (lib/html-publication-bundle serveBundleAsset), so the copy is refused it: an open decision, pinned as it is.
      download: 'owner',
      fetch: 'owner creator',
      trust: 'owner creator',
      export: 'owner creator',
      exportOperation: 'owner creator',
      forkOperation: 'owner creator',
    });
  });

  it('a dataset: the creating token reads it on every door; an export reads only a role that sees it whole', async () => {
    const w = await world();
    expect(await matrix(w, w.dataset, ['page', 'raw', 'export', 'exportOperation', 'forkOperation'])).toEqual({
      page: 'owner creator key',
      raw: 'owner creator key',
      export: 'owner creator',
      exportOperation: 'owner creator',
      forkOperation: 'owner creator',
    });
  });

  it('a group\'s page: the fork operation alone does not admit its creating token', async () => {
    const w = await world();
    const group = await createGroup(w.owner, { handle: 'admission_team', name: 'Admission team' });
    await setArtifact(await getDb(), w.html, { group_id: group.id, user_id: null });
    // The owner is the group's admin; the creator's token made the row and belongs to no member.
    expect(await matrix(w, w.html, ['raw', 'exportOperation', 'forkOperation'])).toEqual({
      raw: 'owner creator key',
      exportOperation: 'owner creator',
      forkOperation: 'owner',
    });
  });
});
