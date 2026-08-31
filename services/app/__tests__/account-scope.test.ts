/**
 * Account-wide bearer scope: a token CLAIMED BY AN ACCOUNT acts for the whole
 * account — any of a user's tokens may read, edit, and manage anything the
 * user owns, because handing an agent a token IS handing it the account's
 * documents (a second agent must be able to pick up where the first left off).
 * Anonymous tokens keep the old boundary: only what they created.
 *
 * Same-direction precedent: render-time image refs already resolve by account,
 * not just token (refDataForRow). This suite pins the API surface.
 */
import { describe, expect, it } from 'vitest';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import {
  DELETE as deleteRoute,
  GET as getArtifactRoute,
  PUT as putArtifact,
} from '@/app/api/artifacts/[id]/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { GET as getVersionRoute } from '@/app/api/artifacts/[id]/versions/[version]/route';
import { GET as listVersionsRoute } from '@/app/api/artifacts/[id]/versions/route';
import { GET as listArtifactsRoute, POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const MARKUP = '<section className="wrap"><p>alpha text</p><p>beta text</p></section>';

interface Wire {
  id: string;
  version: number;
  edit_id: string;
  markup: string | null;
  [k: string]: unknown;
}

async function createMarkup(token: string, markup = MARKUP): Promise<Wire> {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { title: 'doc', markup } }));
  expect(res.status).toBe(201);
  return res.json();
}

describe('account-wide bearer scope', () => {
  it('a second token of the same account reads, edits, and reverts a sibling token’s artifact', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const first = await mintToken('agent-one', user.id);
    const second = await mintToken('agent-two', user.id);
    const made = await createMarkup(first.token);

    // Read: full read-back including the edit head.
    const read = await getArtifactRoute(request(`/api/artifacts/${made.id}`, { token: second.token }), params({ id: made.id }));
    expect(read.status).toBe(200);
    const row = (await read.json()) as Wire;
    expect(row.markup).toContain('alpha text');

    // Edit: the concurrent-edit protocol, based on the head the second token read.
    const edited = await editRoute(
      request(`/api/artifacts/${made.id}/edits`, { method: 'POST', token: second.token, json: { edit_id: row.edit_id, old_string: 'alpha text', new_string: 'gamma text' } }),
      params({ id: made.id }),
    );
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as Wire).markup).toContain('gamma text');

    // Full replace, then the version surface and revert.
    const put = await putArtifact(
      request(`/api/artifacts/${made.id}`, { method: 'PUT', token: second.token, json: { markup: MARKUP.replace('beta', 'delta') } }),
      params({ id: made.id }),
    );
    expect(put.status).toBe(200);

    const versions = await listVersionsRoute(request(`/api/artifacts/${made.id}/versions`, { token: second.token }), params({ id: made.id }));
    expect(versions.status).toBe(200);
    const { versions: list } = (await versions.json()) as { versions: Array<{ version: number }> };
    expect(list.length).toBeGreaterThan(0);
    const archived = list[list.length - 1].version;

    const one = await getVersionRoute(
      request(`/api/artifacts/${made.id}/versions/${archived}`, { token: second.token }),
      params({ id: made.id, version: String(archived) }),
    );
    expect(one.status).toBe(200);

    const reverted = await revertRoute(
      request(`/api/artifacts/${made.id}/revert`, { method: 'POST', token: second.token, json: { version: archived } }),
      params({ id: made.id }),
    );
    expect(reverted.status).toBe(200);
  });

  it('lists the whole account’s artifacts, not just the presenting token’s', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const first = await mintToken('agent-one', user.id);
    const second = await mintToken('agent-two', user.id);
    const made = await createMarkup(first.token);

    const res = await listArtifactsRoute(request('/api/artifacts', { token: second.token }));
    expect(res.status).toBe(200);
    const { artifacts } = (await res.json()) as { artifacts: Array<{ id: string }> };
    expect(artifacts.map((a) => a.id)).toContain(made.id);
  });

  it('resolves refs and dependents across the account’s tokens', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const first = await mintToken('agent-one', user.id);
    const second = await mintToken('agent-two', user.id);

    const ds = (await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: first.token, json: { title: 'The dataset', dataset: [{ region: 'EU', revenue: 837 }] } }),
      )
    ).json()) as Wire;

    // The second token can bind the first token's dataset...
    const doc = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: second.token, json: { title: 'The doc', markup: `<Helmet><Query name="rows">{\`select * from ref_${ds.id}\`}</Query></Helmet><div data-design="tw" className="p-4"><Question data="$rows" title="Rev" /></div>` } }),
    );
    expect(doc.status).toBe(201);
    const docRow = (await doc.json()) as Wire;

    // ...and delete protection sees that dependency from the FIRST token's side.
    const del = await deleteRoute(request(`/api/artifacts/${ds.id}`, { method: 'DELETE', token: first.token }), params({ id: ds.id }));
    expect(del.status).toBe(409);
    expect(((await del.json()) as { dependents: Array<{ id: string }> }).dependents.map((d) => d.id)).toEqual([docRow.id]);
  });

  it('a sibling token can delete an account artifact', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const first = await mintToken('agent-one', user.id);
    const second = await mintToken('agent-two', user.id);
    const made = await createMarkup(first.token);

    const del = await deleteRoute(request(`/api/artifacts/${made.id}`, { method: 'DELETE', token: second.token }), params({ id: made.id }));
    expect(del.status).toBe(200);
    const gone = await getArtifactRoute(request(`/api/artifacts/${made.id}`, { token: first.token }), params({ id: made.id }));
    expect(gone.status).toBe(404);
  });

  it('another user’s token and anonymous tokens still get the uniform 404', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const other = await createUser({ email: 'w@minusx.ai' });
    const mine = await mintToken('mine', user.id);
    const theirs = await mintToken('theirs', other.id);
    const anon = await mintToken('anon', null);
    const made = await createMarkup(mine.token);

    for (const t of [theirs.token, anon.token]) {
      const read = await getArtifactRoute(request(`/api/artifacts/${made.id}`, { token: t }), params({ id: made.id }));
      expect(read.status).toBe(404);
      const put = await putArtifact(
        request(`/api/artifacts/${made.id}`, { method: 'PUT', token: t, json: { markup: MARKUP } }),
        params({ id: made.id }),
      );
      expect(put.status).toBe(404);
    }
  });

  it('anonymous tokens keep the old boundary: their own artifacts only', async () => {
    const anonA = await mintToken('anon-a', null);
    const anonB = await mintToken('anon-b', null);
    const made = await createMarkup(anonA.token);

    const own = await getArtifactRoute(request(`/api/artifacts/${made.id}`, { token: anonA.token }), params({ id: made.id }));
    expect(own.status).toBe(200);
    const foreign = await getArtifactRoute(request(`/api/artifacts/${made.id}`, { token: anonB.token }), params({ id: made.id }));
    expect(foreign.status).toBe(404);
  });
});
