/**
 * THE PAGES, AS THEY ARE NOW: JSON endpoints plus a browser SPA. These
 * helpers answer the three questions the old Next page components expressed
 * as control flow — render, heal the address, or the uniform 404 — and the
 * metadata a document unfurls under, so the suites that pin those behaviours
 * keep asking exactly what they asked before.
 */
import { GET as artifactData } from '@/app/api/page/artifact/[id]/route';
import { GET as profileData } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { CARD_HEIGHT, CARD_WIDTH } from '@/lib/export-card';
import { publicOrigin } from '@/lib/http';
import { displayTitle } from '@/lib/story/title';

export type PageOutcome = { kind: 'render' | 'redirect' | 'notFound'; to?: string };

const BASE = 'http://localhost:3000';

/** `/a/<id>` — what the shell (or the exporter, with a key) gets. */
export async function artifactPage(id: string, opts: { key?: string; cookie?: string } = {}): Promise<PageOutcome> {
  const url = `${BASE}/api/page/artifact/${id}${opts.key ? `?key=${opts.key}` : ''}`;
  const res = await artifactData(new Request(url, { headers: opts.cookie ? { cookie: opts.cookie } : {} }), { params: Promise.resolve({ id }) });
  if (res.status === 404) return { kind: 'notFound' };
  const body = await res.json();
  // The client heals the address; a canonical that differs is the redirect the page used to throw.
  return body.canonical && body.canonical !== `/a/${id}` && !body.surface.captureKey ? { kind: 'redirect', to: body.canonical } : { kind: 'render' };
}

/** A pretty URL — the artifact, the healed address, or the uniform 404. */
export async function profilePage(user: string, path: string[] = [], opts: { cookie?: string } = {}): Promise<PageOutcome> {
  const p = path.join('/');
  const res = await profileData(new Request(`${BASE}/api/page/profile/${user}${p ? '/' + p : ''}`, { headers: opts.cookie ? { cookie: opts.cookie } : {} }), { params: Promise.resolve({ user, ...(p ? { path: p } : {}) }) });
  if (res.status === 404) return { kind: 'notFound' };
  const body = await res.json();
  return body.kind === 'redirect' ? { kind: 'redirect', to: body.to } : { kind: 'render' };
}

export interface ArtifactMeta { title?: string; openGraph?: { title: string; images: Array<{ url: string; width: number; height: number }> }; twitter?: { card: 'summary_large_image' } }

/**
 * What a document unfurls as. Takes the id (fetched under the ACL, so an
 * unreadable one unfurls as nothing) or a row directly, which is how the
 * origin/version rules are asserted without a database.
 */
export async function artifactMetadata(idOrRow: string | ArtifactRow): Promise<ArtifactMeta> {
  if (typeof idOrRow !== 'string') return metaOf(idOrRow);
  const id = idOrRow;
  const row = await getArtifactById(id);
  if (!row) return {};
  const res = await artifactData(new Request(`${BASE}/api/page/artifact/${id}`), { params: Promise.resolve({ id }) });
  if (!res.ok) return {};
  return metaOf(row);
}

async function metaOf(row: ArtifactRow): Promise<ArtifactMeta> {
  const title = displayTitle(row);
  const origin = await publicOrigin();
  return {
    title,
    openGraph: { title, images: [{ url: `${origin}/a/${row.id}/export?mode=card&v=${row.version}`, width: CARD_WIDTH, height: CARD_HEIGHT }] },
    twitter: { card: 'summary_large_image' },
  };
}
