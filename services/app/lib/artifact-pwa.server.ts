import sharp from 'sharp';
import { canReadArtifact, getArtifactById } from './artifacts';
import { sessionActor } from './viewer';
import { ID_RE } from './ids-shape';
import { artifactAppPath, type ArtifactManifest } from './artifact-pwa';

/** Metadata uses the same ACL as content, without export-key admission. */
export async function readableApp(request: Request, id: string) {
  if (!ID_RE.test(id)) return null;
  const row = await getArtifactById(id);
  if (!row) return null;
  const actor = await sessionActor(request);
  return await canReadArtifact(row, actor.viewer) ? row : null;
}

export function artifactManifest(row: { id: string; title: string | null }): ArtifactManifest {
  const base = artifactAppPath(row.id);
  const name = row.title?.trim() || 'Untitled artifact';
  return {
    id: base, name, short_name: name, start_url: base, scope: base,
    display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff',
    icons: [192, 512].map(size => ({ src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
  };
}

/** A deterministic per-artifact mark, with all detail inside the maskable safe zone.
 * No authored SVG, network fetch, font dependency, or persistent content cache. */
export async function artifactAppIcon(id: string, size: 192 | 512): Promise<Buffer> {
  const hash = [...id].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
  const tiles = Array.from({ length: 9 }, (_, i) => `<rect x="${146 + (i % 3) * 78}" y="${146 + Math.floor(i / 3) * 78}" width="64" height="64" rx="12" fill="white" opacity="${(hash >>> i) & 1 ? 1 : 0.35}"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="hsl(${hash % 360},50%,35%)"/>${tiles}</svg>`)).resize(size, size).png().toBuffer();
}
