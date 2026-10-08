/**
 * GET /a/<id>/download — the offline file as an attachment: the reader's
 * credential decides (uniform 404 otherwise), the body is one self-contained
 * HTML file carrying a valid ArtifactFile and the offline bundle.
 */
import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as download } from '@/app/a/[id]/download/route';
import { offlineBundle, offlineExtrasRef } from '@/lib/offline/bundle.server';
import { parseArtifactFile, sourceDigest } from '@/lib/offline/file-format';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser } from '@/lib/accounts';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function owner(name: string) {
  const user = await createUser({ email: `mxmx_test_dl_${name}@example.com` });
  const token = await mintToken(`mxmx_test_dl_${name}`, user.id);
  await claimToken(user.id, token.token);
  return token.token;
}

async function publish(token: string, visibility: 'private' | 'unlisted', source = '<h1>Trip plan</h1><p>Day one.</p>') {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { markup: `---\ntitle: Trip plan\n---\n${source}`, visibility } }));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const fileOf = (html: string) => {
  const m = html.match(/<script type="application\/json" id="afbin-file">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no file block');
  return parseArtifactFile(JSON.parse(m[1]!));
};

describe('GET /a/<id>/download', () => {
  it('gives the owner one self-contained HTML attachment named after the document', async () => {
    const token = await owner('a');
    const id = await publish(token, 'private');
    const res = await download(request(`/a/${id}/download`, { token }), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${id}-trip-plan.jsx.html"; filename*=UTF-8''${id}-trip-plan.jsx.html`);
    const html = await res.text();
    expect(html).toContain('id="afbin-code"');
    const file = fileOf(html);
    expect(file.artifactId).toBe(id);
    expect(file.source).toContain('Trip plan');
    expect(file.bundle).toBe('solid');
    expect(html).not.toContain('id="afbin-wasm"');
  });

  it('lets anyone with the link download an unlisted document', async () => {
    const token = await owner('b');
    const id = await publish(token, 'unlisted');
    const res = await download(request(`/a/${id}/download`), params(id));
    expect(res.status).toBe(200);
  });

  it('answers 404 for a private document the caller cannot read, and for an unknown id', async () => {
    const token = await owner('c');
    const id = await publish(token, 'private');
    expect((await download(request(`/a/${id}/download`), params(id))).status).toBe(404);
    expect((await download(request('/a/Zz99Zz/download'), params('Zz99Zz'))).status).toBe(404);
  });

  it('carries the Mermaid engine only for a document that draws a diagram', async () => {
    const token = await owner('d');
    const id = await publish(token, 'private', '<h1>Flow</h1><Mermaid code="graph TD; A-->B" />');
    const html = await (await download(request(`/a/${id}/download`, { token }), params(id))).text();
    expect(fileOf(html).bundle).toBe('solid');
    const plain = await publish(token, 'private');
    const plainHtml = await (await download(request(`/a/${plain}/download`, { token }), params(plain))).text();
    const code = (h: string) => h.match(/id="afbin-code">([^<]*)</)![1]!;
    const compiled = (h: string) => gunzipSync(Buffer.from(h.match(/id="afbin-compiled-code">([^<]*)</)![1]!, 'base64')).toString('utf8');
    expect(code(html)).toBe(await offlineBundle('solid'));
    expect(code(plainHtml)).toBe(code(html));
    expect(compiled(html).includes('mermaidAPI')).toBe(true);
    expect(plainHtml).not.toContain('id="afbin-compiled-code"');
  });

  it('names its code-view extras and the source its render was built from, and tells an agent how to edit it', async () => {
    const token = await owner('e');
    const id = await publish(token, 'private');
    const html = await (await download(request(`/a/${id}/download`, { token }), params(id))).text();
    const file = fileOf(html);
    expect(file.extras).toEqual(await offlineExtrasRef());
    expect(file.derivedFrom).toBe(sourceDigest(file.source));
    expect(html).toMatch(new RegExp(`^<!doctype html>\\n<!-- artifactbin offline file for "Trip plan" \\(${file.liveUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\.`));
    expect(html).toContain(`<link rel="help" href="${file.origin}/llms.txt"`);
    expect(html).toContain(`script-src 'unsafe-inline' ${new URL(file.origin).origin};`);
    expect(html).not.toContain("'wasm-unsafe-eval'");
    expect(html.indexOf('id="afbin-file"')).toBeLessThan(html.indexOf('id="afbin-code"'));
  });
});
