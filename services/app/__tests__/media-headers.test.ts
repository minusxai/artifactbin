/**
 * THE HEADERS EVERY MEDIA DOOR ANSWERS WITH, in one table: what a browser is told about bytes a person or an agent
 * put here — their type, whether it may sniff, whether they open inline or as a download, whether they may run as a
 * page, and how long anything may keep them. Each row builds its door's real fixture through the real handlers and
 * names the headers that door owes; the flows around those doors (who may upload, replay, ACL rechecks, conversion)
 * stay with their own files: profile-image, feedback-images (app and lib/datasets), file-assets and image-upload.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { Actor } from '@artifactbin/contracts';
import { request, setSession, useAppHarness, mintAccountToken } from '@/__tests__/harness';
import { claimToken, createUser, avatarVersion, getUserById } from '@/lib/accounts';
import { getArtifactById, updateSharingFor, changeMembership } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/artifacts/dataset-policy';
import { PUT as putProfileImage } from '@/app/api/my/profile/image/route';
import { GET as getAvatar } from '@/app/api/users/[id]/avatar/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as sessionCreate } from '@/app/api/my/artifacts/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { GET as resolve } from '@/app/a/[id]/resolve/route';
import { POST as uploadDatasetImage } from '@/app/a/[id]/datasets/[datasetId]/images/route';
import { GET as readDatasetImage } from '@/app/a/[id]/datasets/[datasetId]/images/[imageId]/route';
import { POST as uploadDatasetFile } from '@/app/api/artifacts/[id]/datasets/[datasetId]/files/route';
import { GET as readDatasetFile } from '@/app/a/[id]/datasets/[datasetId]/files/[fileId]/route';

useAppHarness();

const BASE = 'http://localhost:3000';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 255, 42]);
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 40, b: 60 } } }).png().toBuffer();

/** A header expectation: the exact value, or a pattern it must match. */
type Owed = Record<string, string | RegExp>;
interface Door { name: string; serve: () => Promise<Response>; owes: Owed }

/** A generic file artifact uploaded with `contentType`, and its token. */
async function fileArtifact(contentType = 'model/gltf-binary', body: Uint8Array<ArrayBuffer> = GLB) {
  const token = await mintAccountToken('files');
  const response = await createArtifact(new Request(`${BASE}/api/artifacts?format=file&filename=scene.glb`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': contentType }, body,
  }));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

/** The person whose picture is served: signed in, picture set, then a stranger asks. */
async function avatar() {
  const user = await createUser({ email: 'mxmx_test_media_headers_avatar@example.com' });
  setSession({ user: { id: user.id } });
  const put = await putProfileImage(request('/api/my/profile/image', { method: 'PUT', origin: 'same', body: new Uint8Array(await png(300, 300)), headers: { 'content-type': 'image/png' } }));
  expect(put.status, await put.clone().text()).toBe(200);
  setSession(null);
  const version = avatarVersion((await getUserById(user.id))!.image_key!);
  return { user, version, at: (query: string) => getAvatar(request(`/api/users/${user.id}/avatar${query}`), ctx(user.id)) };
}

/** A document whose member uploads an image and files into a private dataset (the feedback-form shape). */
async function datasetUploads() {
  const owner = await createUser({ email: 'mxmx_test_media_headers_owner@example.test' });
  const reporter = await createUser({ email: 'mxmx_test_media_headers_reporter@example.test' });
  const token = await mintAccountToken('media-headers-owner', owner.id);
  await claimToken(owner.id, token.token);
  const ownerActor = { userId: owner.id, tokenId: token.id };
  const make = async (body: object) => {
    const response = await createArtifact(request('/api/artifacts', { method: 'POST', token: token.token, json: body }));
    expect(response.status, await response.clone().text()).toBe(201);
    return response.json();
  };
  const dataset = await make({ dataset: [{ message: 'initial', image_ref: '' }], visibility: 'private', access: 'readwrite' });
  const document = await make({ visibility: 'public', markup: `<Helmet><Import name="feedback" src="ref:${dataset.id}" /><Value name="message" type="string" default="" /><Value name="image_ref" type="string" default="" /><Mutation name="submit">{\`insert into feedback.rows (message,image_ref) values ($message,$image_ref)\`}</Mutation></Helmet>` });
  await updateSharingFor(ownerActor, dataset.id, { shares: [{ email: reporter.email!, role: 'viewer' }] });
  await setDatasetPolicy(ownerActor, dataset.id, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }, { actions: ['insert'], from: { artifact: document.id } }] }, 0);
  await changeMembership({ userId: reporter.id, tokenId: null }, document.id, { action: 'join' });
  await changeMembership(ownerActor, document.id, { action: 'approve', userId: reporter.id });
  const pageActor: Actor = { credential: 'session', userId: reporter.id, email: reporter.email!, emailVerified: true };
  const reporterToken = await mintAccountToken('media-headers-reporter', reporter.id);
  await claimToken(reporter.id, reporterToken.token);
  const params = { params: Promise.resolve({ id: document.id, datasetId: dataset.id }) };
  const bytes = await sharp({ create: { width: 40, height: 24, channels: 3, background: '#c0392b' } }).png().toBuffer();
  const file = async (filename: string, body: BodyInit, key: string) => {
    const made = await uploadDatasetFile(request(`/api/artifacts/${document.id}/datasets/${dataset.id}/files`, { method: 'POST', token: reporterToken.token, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(filename), 'X-Edit-Id': document.edit_id, 'Idempotency-Key': key }, body }), params);
    expect(made.status, await made.clone().text()).toBe(201);
    const stored = (await made.json()) as { ref: string; url: string };
    return () => readDatasetFile(request(stored.url, { actor: pageActor }), { params: Promise.resolve({ id: document.id, datasetId: dataset.id, fileId: stored.ref.slice('dfile:'.length) }) });
  };
  return {
    image: async () => {
      const made = await uploadDatasetImage(request(`/a/${document.id}/datasets/${dataset.id}/images`, { method: 'POST', actor: pageActor, headers: { 'Content-Type': 'image/png', 'X-Edit-Id': document.edit_id, 'Idempotency-Key': 'upload-operation-123' }, body: new Uint8Array(bytes) }), params);
      expect(made.status, await made.clone().text()).toBe(201);
      const stored = (await made.json()) as { ref: string; url: string };
      return readDatasetImage(request(stored.url, { actor: pageActor }), { params: Promise.resolve({ id: document.id, datasetId: dataset.id, imageId: stored.ref.slice('dimg:'.length) }) });
    },
    text: async () => (await file('note.txt', 'hello', 'generic-upload-123'))(),
    picture: async () => (await file('proof.png', new Uint8Array(bytes), 'generic-image-123'))(),
  };
}

const DOORS: Door[] = [
  { name: 'a profile picture at the address its row names', owes: { 'content-type': 'image/webp', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', 'cache-control': 'public, max-age=31536000, immutable' },
    serve: async () => { const a = await avatar(); return a.at(`?v=${a.version}`); } },
  ...['', '?v=stale', '?v=VERSIONx'].map((query): Door => ({ name: `a profile picture at any other address (${query || 'no version'})`, owes: { 'cache-control': 'no-cache' },
    serve: async () => { const a = await avatar(); return a.at(query.replace('VERSION', a.version)); } })),
  { name: 'a dataset image a document member reads', owes: { 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' },
    serve: async () => (await datasetUploads()).image() },
  { name: 'a dataset file download', owes: { 'content-disposition': /^attachment;/, 'content-security-policy': /sandbox/, 'x-content-type-options': 'nosniff' },
    serve: async () => (await datasetUploads()).text() },
  { name: 'a dataset picture filed as a file, converted at the door', owes: { 'content-disposition': /inline; filename="proof\.webp"/ },
    serve: async () => (await datasetUploads()).picture() },
  { name: 'a generic file artifact\'s raw bytes', owes: { 'content-disposition': /^attachment;/, 'content-security-policy': /sandbox/ },
    serve: async () => { const f = await fileArtifact(); return raw(new Request(`${BASE}/a/${f.id}/raw`), ctx(f.id)); } },
  { name: 'a file uploaded claiming text/html: the extension\'s type, inert', owes: { 'content-type': 'model/gltf-binary', 'content-disposition': /^attachment;/, 'x-content-type-options': 'nosniff' },
    serve: async () => { const f = await fileArtifact('text/html', new TextEncoder().encode('<script>alert(1)</script>')); return raw(new Request(`${BASE}/a/${f.id}/raw`), ctx(f.id)); } },
  { name: 'a public file resolved by ref from a document', owes: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    serve: async () => { const f = await fileArtifact(); return resolve(new Request(`${BASE}/a/Doc123/resolve?ref=ref:${f.id}`), ctx('Doc123')); } },
];

describe('every media door answers with the headers it owes', () => {
  it.each(DOORS.map((door) => [door.name, door] as const))('%s', async (_name, door) => {
    const response = await door.serve();
    expect(response.status).toBe(200);
    for (const [header, owed] of Object.entries(door.owes)) {
      const value = response.headers.get(header);
      if (typeof owed === 'string') expect(value, header).toBe(owed);
      else expect(value, header).toMatch(owed);
    }
  });

  // The type an uploaded image is served with is the one its row records (converted at the door,
  // lib/images/optimise), whichever door created it: the agent's bearer upload and the editor's session upload.
  it.each(['bearer', 'session'] as const)('an image uploaded through the %s door is served with the type its row records', async (door) => {
    const user = await createUser({ email: `mxmx_test_media_headers_${door}@example.com` });
    const token = await mintAccountToken('media-headers-image', user.id);
    const upload = new Request(`${BASE}${door === 'bearer' ? '/api/artifacts' : '/api/my/artifacts'}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png', ...(door === 'bearer' ? { Authorization: `Bearer ${token.token}` } : {}) }, body: new Uint8Array(PNG_1x1),
    });
    if (door === 'session') setSession({ user: { id: user.id } });
    const made = await (door === 'bearer' ? createArtifact(upload) : sessionCreate(upload));
    expect(made.status, await made.clone().text()).toBe(201);
    const { id } = (await made.json()) as { id: string };
    const served = await raw(new Request(`${BASE}/a/${id}/raw`), ctx(id));
    expect(served.headers.get('Content-Type')).toBe(((await getArtifactById(id))!.meta as { contentType?: string }).contentType);
  });
});
