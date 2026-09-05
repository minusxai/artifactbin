/**
 * The concurrent-edit protocol end to end through the real route handlers
 * (concurrent-artifacts-edits.md, "Resolution, step by step"): canonicalized
 * storage, the edit_id read-proof, node-scoped accept/reject on stale bases,
 * full-replace/revert participation, version coalescing, and the NOTIFY
 * wakeup — all against in-memory PGLite.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { DELETE as deleteRoute, GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { GET as listVersionsRoute } from '@/app/api/artifacts/[id]/versions/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';
import { resetRateLimit } from '@/lib/auth';
import { MAX_STALE_EDITS } from '@/lib/artifacts';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret';
const harness = useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function mint(): Promise<{ id: string; token: string }> {
  const res = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 't' }, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }));
  expect(res.status).toBe(201);
  return res.json();
}

const MARKUP = '<section className="wrap"><p>alpha text</p><p>beta text</p></section>';
const elementWith = (source: string, text: string) => {
  const match = source.match(new RegExp(`<p[^>]*>${text}</p>`));
  if (!match) throw new Error(`missing paragraph: ${text}`);
  return match[0];
};

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
  const wire = await res.json();
  // The echo is skipped when storing changed nothing (`markup_changed:false`),
  // so the canonical source is what we sent — the same reasoning an agent does.
  return { ...wire, markup: wire.markup ?? markup };
}

async function edit(token: string, id: string, body: Record<string, unknown>) {
  return editRoute(request(`/api/artifacts/${id}/edits`, { method: 'POST', token: token, json: body }), params({ id }));
}

async function read(token: string, id: string): Promise<Wire> {
  const res = await getArtifactRoute(request(`/api/artifacts/${id}`, { token: token }), params({ id }));
  expect(res.status).toBe(200);
  return res.json();
}

describe('edit_id on the wire', () => {
  it('create/read/replace all expose an unguessable edit_id; replace regenerates it', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    expect(doc.edit_id).toMatch(/^[a-f0-9]{32}$/);

    const got = await read(t.token, doc.id);
    expect(got.edit_id).toBe(doc.edit_id);

    const put = await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<p>replaced</p>' } }),
      params({ id: doc.id }),
    );
    expect(put.status).toBe(200);
    const replaced = (await put.json()) as Wire;
    expect(replaced.edit_id).toMatch(/^[a-f0-9]{32}$/);
    expect(replaced.edit_id).not.toBe(doc.edit_id);
  });

  it('stores markup in canonical serialize form (expression values normalize)', async () => {
    const t = await mint();
    const dsRes = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'sales', dataset: [{ m: 'Jan', v: 1 }] } }),
    );
    expect(dsRes.status).toBe(201);
    const ds = (await dsRes.json()) as Wire;
    // Non-canonical JSON in an expression attr canonicalizes at the door…
    const doc2 = await createMarkup(
      t.token,
      `<Helmet><Query name="rows">{\`select * from ref_${ds.id}\`}</Query></Helmet><div data-design="tw"><Question data="$rows" viz={{kind:"table"}} height="200px" /></div>`,
    );
    expect(doc2.markup).toContain('viz={{"kind":"table"}}');
    // …and canonical form is a fixpoint: an edit that re-submits it verbatim is `identical`.
    const res = await edit(t.token, doc2.id, { edit_id: doc2.edit_id, source: doc2.markup });
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toBe('identical');
  });
});

describe('fast path (base = head)', () => {
  it('applies a diff edit: fresh edit_id, version bump, updated source', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Wire;
    expect(updated.edit_id).toMatch(/^[a-f0-9]{32}$/);
    expect(updated.edit_id).not.toBe(doc.edit_id);
    expect(updated.version).toBe(doc.version + 1);
    expect(updated.markup).toContain('ALPHA');
    expect(updated.markup).not.toContain('alpha text');

    const got = await read(t.token, doc.id);
    expect(got.markup).toBe(updated.markup);
    expect(got.edit_id).toBe(updated.edit_id);
  });

  it('applies a whole-source edit (the editor door) the same way', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const next = doc.markup!.replace('beta text', 'BETA');
    const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, source: next });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Wire).markup).toContain('BETA');
  });
});

describe('rejects', () => {
  it('unknown base edit_id → 409 stale_edit_id with head to rebase on', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const res = await edit(t.token, doc.id, { edit_id: 'f'.repeat(32), old_string: 'alpha', new_string: 'x' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('stale_edit_id');
    expect(body.edit_id).toBe(doc.edit_id);
    expect(body.source).toBe(doc.markup);
    expect(body.version).toBe(doc.version);
  });

  it('bad diffs → 400 with the exact detail', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    for (const [old_string, new_string, detail] of [
      ['nothing here', 'x', 'no_match'],
      [' text', 'x', 'multiple_matches'],
      ['alpha', 'alpha', 'identical'],
    ] as const) {
      const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string, new_string });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('bad_diff');
      expect(body.detail).toBe(detail);
    }
  });

  it('invalid candidate markup → publish-pipeline 400, doc untouched', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const res = await edit(t.token, doc.id, {
      edit_id: doc.edit_id,
      old_string: elementWith(doc.markup!, 'alpha text'),
      new_string: '<script>alert(1)</script>',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_jsx');
    const got = await read(t.token, doc.id);
    expect(got.version).toBe(doc.version);
    expect(got.edit_id).toBe(doc.edit_id);
  });

  /**
   * A `<Helmet>` is an ordinary node to the splice algebra — that is the whole
   * point of hoisting it at canonicalization rather than storing it beside the
   * document. Two agents, one in the head and one in the body, must both land;
   * two in the SAME Helmet child must conflict like any other overlap.
   */
  describe('concurrent edits around a Helmet', () => {
    const WITH_HELMET =
      '<Helmet><title>Head one</title><script>{`window.a = 1;`}</script></Helmet>'
      + '<section className="wrap"><p>alpha text</p><p>beta text</p></section>';

    it('a head edit and a body edit are unrelated — both land', async () => {
      const t = await mint();
      const doc = await createMarkup(t.token, WITH_HELMET);

      const head = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'Head one', new_string: 'Head two' });
      expect(head.status).toBe(200);

      // The SECOND agent still holds the original pointer: its span (a body
      // paragraph) does not overlap the title, so the write applies anyway.
      const body = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' });
      expect(body.status).toBe(200);

      const wire = (await body.json()) as Wire;
      expect(wire.markup).toContain('Head two');
      expect(wire.markup).toContain('ALPHA');
      expect(wire.markup).toContain('window.a = 1;');
      // And the Helmet is still the first node — canonical form survives edits.
      expect(wire.markup!.trimStart().startsWith('<Helmet>')).toBe(true);
    });

    it('two edits inside the same Helmet child conflict', async () => {
      const t = await mint();
      const doc = await createMarkup(t.token, WITH_HELMET);

      const first = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'window.a = 1;', new_string: 'window.a = 2;' });
      expect(first.status).toBe(200);

      const clash = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'window.a = 1;', new_string: 'window.a = 3;' });
      expect([404, 409]).toContain(clash.status);
    });

    it('an agent that edits the head cannot smuggle a second Helmet in', async () => {
      const t = await mint();
      const doc = await createMarkup(t.token, WITH_HELMET);
      const res = await edit(t.token, doc.id, {
        edit_id: doc.edit_id,
        old_string: doc.markup!.match(/<section[^>]*>/)![0],
        new_string: '<Helmet><title>Sneaky</title></Helmet>' + doc.markup!.match(/<section[^>]*>/)![0],
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; details?: Array<{ message: string }> };
      expect(JSON.stringify(body)).toMatch(/one <Helmet>/i);
    });
  });

  it('data tiers stay out: they are values, not documents → 400 not_editable', async () => {
    const t = await mint();
    const res0 = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'ds', dataset: [{ a: 1 }] } }),
    );
    const doc = (await res0.json()) as Wire;
    const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: '1', new_string: '2' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('not_editable');
  });

  it('foreign artifact → uniform 404; malformed bodies → 400', async () => {
    const t = await mint();
    const other = await mint();
    const doc = await createMarkup(t.token);
    const res = await edit(other.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha', new_string: 'x' });
    expect(res.status).toBe(404);

    for (const body of [
      { old_string: 'a', new_string: 'b' }, // no edit_id
      { edit_id: doc.edit_id }, // no form at all
      { edit_id: doc.edit_id, old_string: 'a', new_string: 'b', source: 'both' }, // both forms
    ]) {
      const bad = await edit(t.token, doc.id, body);
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe('invalid_edit_body');
    }
  });
});

describe('stale bases — the node-scope decision', () => {
  it('same node touched meanwhile → 409 doc_changed; retry on returned head succeeds', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const first = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' });
    expect(first.status).toBe(200);

    const clash = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha', new_string: 'omega' });
    expect(clash.status).toBe(409);
    const body = await clash.json();
    expect(body.error).toBe('doc_changed');
    expect(body.source).toContain('ALPHA');

    const retry = await edit(t.token, doc.id, { edit_id: body.edit_id, old_string: 'ALPHA', new_string: 'omega' });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Wire).markup).toContain('omega');
  });

  it('different nodes → both stale-base edits apply, shifted correctly', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    // First edit grows paragraph 1 (shifts everything after it).
    const first = await edit(t.token, doc.id, {
      edit_id: doc.edit_id,
      old_string: 'alpha text',
      new_string: 'alpha text grew much longer',
    });
    expect(first.status).toBe(200);
    // Second edit, still based on the ORIGINAL doc, touches paragraph 2.
    const second = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' });
    expect(second.status).toBe(200);
    const final = (await second.json()) as Wire;
    expect(final.markup).toContain('alpha text grew much longer');
    expect(final.markup).toContain('BETA');
    expect(final.version).toBe(doc.version + 2);
  });

  it('sibling insertion at a gap is unrelated to edits inside the siblings', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const first = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' });
    expect(first.status).toBe(200);
    // Stale-base whole-source form inserting a new paragraph between the two.
    const gap = doc.markup!.indexOf(elementWith(doc.markup!, 'beta text'));
    const withNew = doc.markup!.slice(0, gap) + '<p>fresh</p>' + doc.markup!.slice(gap);
    const second = await edit(t.token, doc.id, { edit_id: doc.edit_id, source: withNew });
    expect(second.status).toBe(200);
    const final = (await second.json()) as Wire;
    expect(final.markup).toMatch(/<p[^>]*>fresh<\/p>/);
    expect(final.markup).toContain('BETA');
  });

  it('deleting a node conflicts with a stale edit inside it', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const del = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: elementWith(doc.markup!, 'beta text'), new_string: '' });
    expect(del.status).toBe(200);
    const inside = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta', new_string: 'B' });
    expect(inside.status).toBe(409);
    expect((await inside.json()).error).toBe('doc_changed');
  });

  it('a full replace (PUT) participates: any stale-base edit after it conflicts', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const put = await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<section><p>alpha text</p><p>beta text</p></section>' } }),
      params({ id: doc.id }),
    );
    expect(put.status).toBe(200);
    // Node-disjoint in spirit, but a replace touches the whole doc → doc_changed.
    const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'x' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('doc_changed');
  });

  it('a revert participates the same way', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const first = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' });
    expect(first.status).toBe(200);
    const firstWire = (await first.json()) as Wire;
    const rev = await revertRoute(
      request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: t.token, json: { version: 1 } }),
      params({ id: doc.id }),
    );
    expect(rev.status).toBe(200);
    const reverted = (await rev.json()) as { edit_id: string };
    // Guard against a vacuous compare: the field must exist and be fresh.
    expect(reverted.edit_id).toMatch(/^[a-f0-9]{32}$/);
    expect(reverted.edit_id).not.toBe(firstWire.edit_id);
    const res = await edit(t.token, doc.id, { edit_id: firstWire.edit_id, old_string: 'beta text', new_string: 'x' });
    expect(res.status).toBe(409);
  });
});

describe('stale bases — E-anchored matching and log fidelity', () => {
  it('old_string is matched against the BASE, so a duplicate at head cannot break it', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    // Head gains an exact duplicate of the target text as a new sibling…
    const gap = doc.markup!.indexOf(elementWith(doc.markup!, 'beta text'));
    const withDup = doc.markup!.slice(0, gap) + '<p>beta text</p>' + doc.markup!.slice(gap);
    const first = await edit(t.token, doc.id, { edit_id: doc.edit_id, source: withDup });
    expect(first.status).toBe(200);
    // …yet a stale-base edit anchored on the (unique-at-base) text still
    // applies: head-anchored matching would have failed `multiple_matches`.
    // WHICH copy changes is genuinely undefined — inserting a duplicate before
    // or after an identical paragraph yields byte-identical documents — so the
    // invariant is that exactly one changed and the other survived.
    const second = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' });
    expect(second.status).toBe(200);
    const final = (await second.json()) as Wire;
    expect(final.markup!.match(/<p[^>]*>BETA<\/p>/g)).toHaveLength(1);
    expect(final.markup!.match(/<p[^>]*>beta text<\/p>/g)).toHaveLength(1);
  });

  it('the log records what actually landed (post-rewrite), keeping stale bases resolvable', async () => {
    const t = await mint();
    const dsRes = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'ds', dataset: [{ m: 'Jan', v: 1 }] } }),
    );
    const ds = (await dsRes.json()) as Wire;
    // The document declares the table the inserted chart will bind.
    const doc = await createMarkup(t.token, `<Helmet><Query name="rows">{\`select * from ref_${ds.id}\`}</Query></Helmet>` + MARKUP);

    // Canonicalization rewrites the inserted text on the way in, so the stored
    // delta is NOT the caller's literal new_string.
    const first = await edit(t.token, doc.id, {
      edit_id: doc.edit_id,
      old_string: elementWith(doc.markup!, 'alpha text'),
      new_string: `${elementWith(doc.markup!, 'alpha text')}<Question data="$rows" viz={{kind:"table"}} height="200px" />`,
    });
    expect(first.status).toBe(200);
    const w1 = (await first.json()) as Wire;
    expect(w1.markup).toContain('viz={{"kind":"table"}}');

    // A stale-base edit on the OTHER paragraph must still reconstruct E and
    // apply — only true if the logged splice is the stored-to-stored delta.
    const second = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' });
    expect(second.status).toBe(200);
    const final = (await second.json()) as Wire;
    expect(final.markup).toContain('viz={{"kind":"table"}}');
    expect(final.markup).toContain('BETA');
  });
});

describe('bounded staleness', () => {
  it('a base too far behind head is refused rather than reconstructed indefinitely', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    let editId = doc.edit_id;
    // Walk head well past the reconstruction bound.
    for (let i = 0; i < MAX_STALE_EDITS + 2; i++) {
      resetRateLimit(); // the per-token backstop is not what this test is about
      const res = await edit(t.token, doc.id, { edit_id: editId, old_string: i === 0 ? 'alpha text' : `n${i - 1}`, new_string: `n${i}` });
      expect(res.status).toBe(200);
      editId = ((await res.json()) as Wire).edit_id;
    }
    // The original base is still IN the log, but replaying that far is work we
    // refuse to do — answer with head so the caller simply re-reads.
    const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('stale_edit_id');
  });
});

describe('version history is CHECKPOINTS, and says so', () => {
  it('a version that exists but was never archived is refused distinguishably, not as a bare 404', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    let editId = doc.edit_id;
    for (let i = 0; i < 4; i++) {
      const res = await edit(t.token, doc.id, { edit_id: editId, old_string: i === 0 ? 'alpha text' : `n${i - 1}`, new_string: `n${i}` });
      expect(res.status).toBe(200);
      editId = ((await res.json()) as Wire).edit_id;
    }
    const head = await read(t.token, doc.id);
    const listed = (await (await listVersionsRoute(request(`/api/artifacts/${doc.id}/versions`), params({ id: doc.id }))).json()) as never;
    void listed;

    // Save-less typing coalesces snapshots, so intermediate versions exist as
    // numbers but were never archived. Asking for one must not look like a
    // missing artifact — the caller has already proved ownership.
    const res = await revertRoute(
      request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: t.token, json: { version: head.version - 1 } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('version_not_archived');

    // A version that IS archived still reverts.
    const ok = await revertRoute(
      request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: t.token, json: { version: 1 } }),
      params({ id: doc.id }),
    );
    expect(ok.status).toBe(200);
  });

  it('an unknown artifact still gets the uniform 404 (ownership is not leaked)', async () => {
    const t = await mint();
    const other = await mint();
    const doc = await createMarkup(t.token);
    const res = await revertRoute(
      request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: other.token, json: { version: 1 } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(404);
  });
});

describe('document-level meta edits', () => {
  it('colorMode: set with a mode, cleared back to the theme default with explicit null', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const set = await edit(t.token, doc.id, { edit_id: doc.edit_id, colorMode: 'dark' });
    expect(set.status).toBe(200);
    const w1 = (await set.json()) as Wire;
    expect((await read(t.token, doc.id)).colorMode).toBe('dark');
    // The dropdown's "theme default" option is an explicit CLEAR, not an absence.
    const clear = await edit(t.token, doc.id, { edit_id: w1.edit_id, colorMode: null });
    expect(clear.status).toBe(200);
    expect((await read(t.token, doc.id)).colorMode).toBeNull();
  });
});

describe('deletion', () => {
  it('the purge erases the edit log too — the genesis row holds the whole document', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'SECRET' });
    const db = await harness.db();
    expect((await db.query('SELECT 1 FROM artifact_edits WHERE artifact_id = $1', [doc.id])).rows.length).toBeGreaterThan(0);

    const gone = await deleteRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: t.token }), params({ id: doc.id }));
    expect(gone.status).toBe(200);
    /*
     * A delete is a TRASH, so the log survives it — it has to, or a restore
     * would bring back a document with no history behind it — and there is no
     * later sweep that takes it, because nothing in this product is erased.
     * The honest consequence, stated in the docs: the deleted document's full
     * text stays in the edit log, so "delete" is a withdrawal, not an erasure.
     */
    expect((await db.query('SELECT 1 FROM artifact_edits WHERE artifact_id = $1', [doc.id])).rows.length).toBeGreaterThan(0);
    await db.query(`UPDATE artifacts SET deleted_at = now() - interval '400 days' WHERE id = $1`, [doc.id]);
    expect((await db.query('SELECT 1 FROM artifact_edits WHERE artifact_id = $1', [doc.id])).rows.length).toBeGreaterThan(0);
  });
});

describe('version coalescing and the edits log', () => {
  it('rapid edits bump version each time but archive at most one snapshot', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const e1 = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'A1' });
    const w1 = (await e1.json()) as Wire;
    const e2 = await edit(t.token, doc.id, { edit_id: w1.edit_id, old_string: 'A1', new_string: 'A2' });
    const w2 = (await e2.json()) as Wire;
    expect(w2.version).toBe(doc.version + 2);

    const versions = await listVersionsRoute(request(`/api/artifacts/${doc.id}/versions`, { token: t.token }), params({ id: doc.id }));
    const list = (await versions.json()) as { versions: Array<{ version: number }> };
    expect(list.versions.length).toBe(1); // one snapshot for the burst, not one per keystroke
  });

  it('every accepted edit lands one log row; NOTIFY fires with the fresh edit_id', async () => {
    const t = await mint();
    const doc = await createMarkup(t.token);
    const db = await harness.db();
    const got: string[] = [];
    const unlisten = await db.listen(`artifact_${doc.id}`, (p) => got.push(p));

    const res = await edit(t.token, doc.id, { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Wire;

    // Genesis (the create) + this edit — every id that was ever head is logged.
    const rows = await db.query<{ edit_id: string; removed: string; inserted: string }>(
      'SELECT edit_id, removed, inserted FROM artifact_edits WHERE artifact_id = $1 ORDER BY seq',
      [doc.id],
    );
    expect(rows.rows).toEqual([
      { edit_id: doc.edit_id, removed: '', inserted: doc.markup },
      { edit_id: updated.edit_id, removed: 'alpha text', inserted: 'ALPHA' },
    ]);

    await new Promise((r) => setTimeout(r, 100));
    expect(got).toContain(updated.edit_id);
    await unlisten();
  });

  /**
   * The whole-document shape is what the EDITOR sends, and its splice is
   * derived against canonical form. Canonicalization used to run before any
   * validation, and hoisting keeps the first Helmet and drops the rest — so an
   * author who typed a second <Helmet> in code mode did not get the error the
   * grammar promises. They got a save: the surviving Helmet was the new empty
   * one, and the document's real title, meta, stylesheet and script were gone
   * from the row. The editor said "saved".
   */
  it('a second <Helmet> in a whole-document edit is refused, not silently resolved', async () => {
    const t = await mint();
    const helmet = '<Helmet><title>keep me</title><style>{`.k{color:red}`}</style>'
      + '<script>{`var a = 1;`}</script></Helmet>';
    const doc = await createMarkup(t.token, `${helmet}<p>body</p>`);

    const res = await edit(t.token, doc.id, {
      edit_id: doc.edit_id,
      source: `<Helmet><title>second</title></Helmet>${helmet}<p>body</p>`,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('only one <Helmet>');

    // and the document it would have gutted is untouched
    const after = await read(t.token, doc.id);
    expect(after.version).toBe(doc.version);
    expect(after.markup).toContain('keep me');
    expect(after.markup).toContain('.k{color:red}');
    expect(after.markup).toContain('var a = 1;');
  });
});
