/**
 * PHOTOGRAPHING AN OLDER VERSION — `afbin export <id>@1 --format png`.
 *
 * The renderer only ever knew how to shoot the head, so the CLI refused a
 * version outright. It can shoot one now because the served document can RENDER
 * one (`/a/<id>/raw?chrome=0&version=N&key=…` — lib/archived-version), and the
 * two things that had to follow it are pinned here:
 *
 *  - the photographed URL names the version, so the browser is not sent to the
 *    head and handed back a picture labelled "version 1";
 *  - the cache key is a DIFFERENT key, because `/export`'s cache is keyed by
 *    artifact and revision and would otherwise serve the head's picture — or
 *    overwrite it with the archived one — under one id.
 *
 * The ACL is the door's, and it is the version history's, not the read ACL's:
 * this document is PUBLIC, and an anonymous reader still gets the uniform 404.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserService, RenderRequest, RenderResult } from '@artifactbin/contracts';
import { exportCacheKey, resetExportRenderer } from '@/lib/export';
import { setServices } from '@/lib/services';
import { useAppHarness, request } from '@/__tests__/harness';
import { EXPORT_PNG } from '@/__tests__/export-helpers';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import {documentEditBody} from '@/__tests__/prepared-document';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** A browser that always answers this PNG, and keeps every request it was sent. */
function scripted(answer: RenderResult): BrowserService & { seen: RenderRequest[] } {
  const seen: RenderRequest[] = [];
  return { seen, async render(req) { seen.push(req); return answer; } };
}
const PNG: RenderResult = { ok: true, mime: 'image/png', bytes: EXPORT_PNG };

beforeEach(async () => { await resetExportRenderer(); });
afterEach(async () => { await resetExportRenderer(); setServices({ browser: undefined }); });

async function twoVersions() {
  const owner = await mintToken('archived-export');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: '<p>Version one</p>', visibility: 'public' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const head = (await getArtifactById(id))!;
  const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody(head,{source:'<p>Version two</p>',whole:true}) }), params({ id }));
  expect(replaced.status, await replaced.clone().text()).toBe(200);
  return { owner, id };
}

describe('an image export of an archived version', () => {
  it('photographs that version and keys its image apart from the head', async () => {
    const { owner, id } = await twoVersions();
    const browser = scripted(PNG);
    setServices({ browser });

    const res = await exportRoute(
      request(`/a/${id}/export?format=png&version=1`, { token: owner.token, headers: { 'X-Artifactbin-Protocol': '1' } }),
      params({ id }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');

    // The page the browser was sent to is THAT version's document, not the head's.
    expect(browser.seen).toHaveLength(1);
    const shot = new URL(browser.seen[0]!.url);
    expect(shot.pathname).toBe(`/a/${id}/raw`);
    expect(shot.searchParams.get('version')).toBe('1');
    expect(shot.searchParams.get('chrome')).toBe('0');

    // Two pictures of one artifact at one revision need two keys.
    const at = { id, version: 2 };
    expect(exportCacheKey(at, 'png', 'full', 0, '', 1)).not.toBe(exportCacheKey(at, 'png', 'full', 0, '', null));
    // …and the head's key is exactly the key it has always had.
    expect(exportCacheKey(at, 'png', 'full', 0, '', null)).toBe(exportCacheKey(at, 'png', 'full'));
  });

  it('refuses a version to a reader who may read the document but not its history', async () => {
    const { id } = await twoVersions();
    const browser = scripted(PNG);
    setServices({ browser });
    const res = await exportRoute(request(`/a/${id}/export?format=png&version=1`), params({ id }));
    expect(res.status).toBe(404);
    // Nothing was photographed: the refusal is before the render, not after it.
    expect(browser.seen).toHaveLength(0);
    // The head is still exported for the same anonymous reader.
    const head = await exportRoute(request(`/a/${id}/export?format=png`, { headers: { 'X-Artifactbin-Protocol': '1' } }), params({ id }));
    expect(head.status, await head.clone().text()).toBe(200);
  });
});
