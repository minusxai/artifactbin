/**
 * Raw-body image upload (P2): an image can be POSTed as its own bytes with a
 * `Content-Type: image/*` header, on both the bearer route (agents) and its
 * session twin (the browser editor). No base64, no JSON envelope. The session
 * twin creates a genuinely user-owned artifact, so it needs a token to hang it
 * on — ensureUserToken mints one 'web' token per account and reuses it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { POST as bearerCreate } from '@/app/api/artifacts/route';
import { POST as sessionCreate, GET as sessionList } from '@/app/api/my/artifacts/route';
import { createArtifact, getArtifactById, refDataForRow } from '@/lib/artifacts';
import { storeImageContent } from '@/lib/story/data-tiers';


import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import type { StoredContent } from '@/lib/story/input';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as previewRoute } from '@/app/api/preview/route';
import { objectKey, objectStore, ObjectUnavailable } from '@/lib/object-store';
import { optimiseImage } from '@/lib/images/optimise';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';

// The session routes read auth(); this file owns the mock (mutable id).
const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

// A real 1×1 PNG.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function imgReq(path: string, opts: { token?: string; bytes?: Buffer; contentType?: string } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': opts.contentType ?? 'image/png' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: new Uint8Array(opts.bytes ?? PNG_BYTES),
  });
}

function jsonReq(path: string, opts: { token?: string; body: unknown }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(opts.body) });
}

beforeEach(async () => {
  sessionUser.id = '';
});

describe('bearer raw-body image upload', () => {
  it('creates an image artifact from raw bytes and serves them', async () => {
    const t = await mintToken('t');
    const res = await bearerCreate(imgReq('/api/artifacts', { token: t.token }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('image');
    const raw = await serveArtifact(imgReq(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(raw.status).toBe(200);
    // Converted at the door (lib/images/optimise) — the row records what it
    // became, and the response has to agree with the row, not with the upload.
    expect(raw.headers.get('Content-Type')).toBe(
      ((await getArtifactById(body.id))!.meta as { contentType?: string }).contentType,
    );
    // The served bytes are the STORED bytes, and the store never returns more
    // than it was given (lib/images/optimise's floor).
    const meta = (await getArtifactById(body.id))!.meta as { bytes?: number };
    const served = (await raw.arrayBuffer()).byteLength;
    expect(served).toBe(meta.bytes);
    expect(served).toBeLessThanOrEqual(PNG_BYTES.length);
  });

  it('rejects an unsupported image type', async () => {
    const t = await mintToken('t');
    const res = await bearerCreate(imgReq('/api/artifacts', { token: t.token, contentType: 'image/tiff' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_image');
  });

  it('rejects an image over the size cap', async () => {
    const t = await mintToken('t');
    // vitest env caps MAX_IMAGE_BYTES at 5000.
    const res = await bearerCreate(imgReq('/api/artifacts', { token: t.token, bytes: Buffer.alloc(6000, 1) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('image_too_large');
  });

  it('still accepts a JSON content body (no regression)', async () => {
    const t = await mintToken('t');
    const res = await bearerCreate(jsonReq('/api/artifacts', { token: t.token, body: { title: 'h', markup: '<h1>hi</h1>' } }));
    expect(res.status).toBe(201);
    expect((await res.json()).format).toBe('markup');
  });
});

describe('session raw-body image upload', () => {
  it('creates a user-owned image and serves it', async () => {
    const user = await createUser({ email: 'a@example.com' });
    sessionUser.id = user.id;
    const res = await sessionCreate(imgReq('/api/my/artifacts', {}));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('image');

    const row = await getArtifactById(body.id);
    expect(row!.user_id).toBe(user.id); // genuinely owned by the account

    const raw = await serveArtifact(imgReq(`/a/${body.id}/raw`), params({ id: body.id }));
    // Converted at the door (lib/images/optimise) — the row records what it
    // became, and the response has to agree with the row, not with the upload.
    expect(raw.headers.get('Content-Type')).toBe(
      ((await getArtifactById(body.id))!.meta as { contentType?: string }).contentType,
    );
  });

  it('401s without a session', async () => {
    const res = await sessionCreate(imgReq('/api/my/artifacts', {}));
    expect(res.status).toBe(401);
  });

  it('mints exactly one reusable web token per account', async () => {
    const user = await createUser({ email: 'b@example.com' });
    sessionUser.id = user.id;
    await sessionCreate(imgReq('/api/my/artifacts', {}));
    await sessionCreate(imgReq('/api/my/artifacts', {}));
    const db = await harness.db();
    const r = await db.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM tokens WHERE user_id = $1 AND name = 'web'",
      [user.id],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it('honors ?visibility=unlisted on a raw-body upload', async () => {
    const user = await createUser({ email: 'c@example.com' });
    sessionUser.id = user.id;
    const res = await sessionCreate(imgReq('/api/my/artifacts?visibility=unlisted', {}));
    const body = await res.json();
    const row = await getArtifactById(body.id);
    expect(row!.visibility).toBe('unlisted');
  });

  it('lists a session-created image on the account (twin of the bearer list)', async () => {
    const user = await createUser({ email: 'd@example.com' });
    sessionUser.id = user.id;
    const created = await (await sessionCreate(imgReq('/api/my/artifacts', {}))).json();
    const list = await (await sessionList(new Request(`${BASE}/api/my/artifacts`))).json();
    expect(list.artifacts.map((a: { id: string }) => a.id)).toContain(created.id);
  });

  it('a private image is a hole to a sessionless reader (why born-unlisted matters)', async () => {
    // The exporter's browser has no session; a private image would 404 for it
    // and bake a hole into the PNG. This is the ACL the raw route runs BEFORE
    // the image case — proven here so the born-unlisted default is load-bearing.
    const user = await createUser({ email: 'f@example.com' });
    sessionUser.id = user.id;
    const created = await (await sessionCreate(imgReq('/api/my/artifacts?visibility=private', {}))).json();
    const rowPrivate = await getArtifactById(created.id);
    expect(rowPrivate!.visibility).toBe('private');
    // No session (the exporter): the ACL denies, uniform 404.
    sessionUser.id = '';
    const raw = await serveArtifact(imgReq(`/a/${created.id}/raw`), params({ id: created.id }));
    expect(raw.status).toBe(404);
  });

  it('resolves an image ref owned by the same USER under a different token', async () => {
    // The bug the prod session-paste exposed: a logged-in human pastes an image
    // into a doc whose token_id differs from the account's 'web' token (any
    // claimed-agent doc). The user-scoped edit validates and stores the ref, but
    // refDataForRow resolved by the DOC's token only, so the <img> rendered
    // broken for every reader. Doc under token A, image under token B, one user.
    const user = await createUser({ email: 'x@example.com' });
    const tokenA = await mintToken('agent', user.id); // the doc's token
    const tokenB = await mintToken('web', user.id); // ensureUserToken's token (the paste)

    const stored = await storeImageContent(PNG_BYTES, 'image/png');
    const img = await createArtifact(tokenB.id, user.id, {
      ...(stored as StoredContent), title: null, description: null,
    });
    const doc = await createArtifact(tokenA.id, user.id, {
      format: 'markup', content: '',
      source: `<div data-design="tw"><img src="ref:${img.id}" alt="" /></div>`,
      meta: { refs: [{ id: img.id, kind: 'image' }] }, title: 'doc', description: null,
    });

    const refData = await refDataForRow((await getArtifactById(doc.id))!);
    expect(refData[img.id]).toBeDefined();
    expect((refData[img.id] as { url: string }).url).toContain(`/a/${img.id}/raw`);
  });

  it('still accepts a JSON content body (session create twin)', async () => {
    const user = await createUser({ email: 'e@example.com' });
    sessionUser.id = user.id;
    const res = await sessionCreate(jsonReq('/api/my/artifacts', { body: { title: 'doc', markup: '<h1>Hello</h1>' } }));
    expect(res.status).toBe(201);
    expect((await res.json()).format).toBe('markup');
  });
});


/**
 * A PREVIEW STORES NOTHING — and the image tier could not keep that promise.
 *
 * `/api/preview` exists to compile a draft, and every optional member of
 * `ContentInputCtx` degrades to "do less" for it. Storing the bytes IS what
 * publishing an image is, though, so previewing one PUT an object with no
 * artifact row to reference it — and THE DB IS THE ONLY INDEX, so that object
 * could never be found again, billed, or deleted. Any credential could have
 * filled the disk a few megabytes at a time. Found by milestone 3, which fixed
 * the same shape in the PDF tier (`pdf_not_previewable`) and booked this one
 * here.
 *
 * The refusal is by NAME, and it costs the product nothing: the only caller of
 * /api/preview in this app is the in-place editor's draft CSS compile, which
 * sends `markup` (its draft DATA re-run goes to /api/query), and the docs never
 * teach the route at all.
 */
describe('previewing an image', () => {
  /*
   * Its OWN bytes: the store is content-addressed, so a PNG another test in
   * this file has already published would be at its key whatever this one did.
   */
  const OWN = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4EIwDiqkL4KAV6+A/9m/6EkAAAAAElFTkSuQmCC',
    'base64',
  );
  const dataUrl = `data:image/png;base64,${OWN.toString('base64')}`;
  const preview = (json: unknown, token: string) =>
    previewRoute(request('/api/preview', { method: 'POST', token, json }));

  it('is refused by name, and stores nothing', async () => {
    const t = await mintToken('t');
    // The exact object publishing it WOULD have stored.
    const fit = await optimiseImage(OWN, 'image/png');
    const key = objectKey('image', fit.buffer);

    const res = await preview({ image: dataUrl }, t.token);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('image_not_previewable');
    await expect(objectStore().get(key)).rejects.toBeInstanceOf(ObjectUnavailable);
  });

  it('refuses an image URL before it fetches anything', async () => {
    const t = await mintToken('t');
    // A closed port: anything that reached the network would fail differently.
    const res = await preview({ imageUrl: 'http://127.0.0.1:9/photo.png' }, t.token);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('image_not_previewable');
  });

  it('still compiles a draft document, which is what the route is for', async () => {
    const t = await mintToken('t');
    const res = await preview({ markup: '<h1 className="text-2xl">Draft</h1>' }, t.token);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).css).toBe('string');
  });
});


/**
 * THE LABEL IS NOT THE FILE.
 *
 * `storeImageContent` is the one door every upload comes through — the picker,
 * a paste, a drop, the raw-body POST and the JSON data URL — and it took the
 * caller's word for what the bytes were. `{image: "data:image/png;base64,<a
 * PDF>"}` answered 201 and the document then served a PDF as `image/png`,
 * under `nosniff`, which is the header that makes our word final. The URL
 * importer has sniffed since it existed (lib/web-ingest/sniff, for exactly this
 * reason: a remote label is attacker-controlled); the upload door now asks the
 * same question of the same bytes.
 */
describe('what the bytes actually are', () => {
  const asImage = (bytes: Buffer, label: string) => bearerCreate(request('/api/artifacts', {
    method: 'POST', token: uploadToken, json: { image: `data:${label};base64,${bytes.toString('base64')}` },
  }));
  let uploadToken = '';
  beforeEach(async () => { uploadToken = (await mintToken('t')).token; });

  it('refuses bytes that are not an image, whatever they claim to be', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
    const res = await asImage(pdf, 'image/png');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_image');
  });

  it('stores the type it SNIFFED, not the one it was told', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    const res = await asImage(svg, 'image/png');
    expect(res.status).toBe(201);
    const { id } = await res.json();
    // SVG is text that scales: sniffed, and still passed through untouched.
    expect(((await getArtifactById(id))!.meta as { contentType: string }).contentType).toBe('image/svg+xml');

    const mislabelled = await asImage(PNG_BYTES, 'image/jpeg');
    expect(mislabelled.status).toBe(201);
    const png = await mislabelled.json();
    expect(((await getArtifactById(png.id))!.meta as { contentType: string }).contentType).not.toBe('image/jpeg');
  });
});
