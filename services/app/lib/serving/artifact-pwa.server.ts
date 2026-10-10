import sharp from 'sharp';
import { graphNodes } from '../document';
import { readPwaSettings, type PwaSettings } from '../document/head';
import { loadImage } from '@/lib/object-store/image-store';
import { canReadArtifact, type ArtifactRow } from '../artifacts/access';
import { getArtifactById } from '../artifacts/store';
import { unservable } from '../artifacts/servable';
import { referencedArtifactForRow } from '../artifacts/dataflow';
import { sessionActor } from '../accounts';
import { escapeAttr } from '@artifactbin/utils/escape';
import { ID_RE } from '../platform/ids-shape';
import { artifactAppPath, type ArtifactManifest } from './artifact-pwa';

type PwaRow = Pick<ArtifactRow, 'format' | 'version' | 'meta' | 'source' | 'document'>;
const graphSettings = new WeakMap<object, PwaSettings>();

/** Published rows already carry the parsed graph. Reuse it for every PWA
 * consumer; source-only legacy rows retain the editor's parsing fallback. */
function settingsForRow(row: PwaRow): PwaSettings {
  // A stored document the current code does not serve (lib/artifacts/servable) declares no app: its graph is never walked.
  if (unservable(row)) return {};
  if (row.document?.kind !== 'graph') return readPwaSettings(row.source ?? '');
  const cached = graphSettings.get(row.document);
  if (cached) return cached;
  const settings = readPwaSettings(graphNodes(row.document));
  graphSettings.set(row.document, settings);
  return settings;
}

/** Metadata uses the same ACL as content, without export-key admission. */
export async function readableApp(request: Request, id: string) {
  if (!ID_RE.test(id)) return null;
  const row = await getArtifactById(id);
  if (!row) return null;
  const actor = await sessionActor(request);
  return await canReadArtifact(row, actor.viewer) ? row : null;
}

export function artifactManifest(row: PwaRow & Pick<ArtifactRow, 'id' | 'title'>): ArtifactManifest {
  const base = artifactAppPath(row.id);
  const settings = settingsForRow(row);
  const name = settings.name ?? (row.title?.trim() || 'Untitled artifact');
  return {
    id: base, name, short_name: settings.shortName ?? name, start_url: base, scope: base,
    display: 'standalone', background_color: settings.backgroundColor ?? '#ffffff', theme_color: settings.themeColor ?? '#ffffff',
    icons: [192, 512].map(size => ({ src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
  };
}

/** A deterministic per-artifact mark, with all detail inside the maskable safe zone.
 * No authored SVG, network fetch, font dependency, or persistent content cache. */
export async function artifactAppIcon(row: ArtifactRow, size: 192 | 512): Promise<Buffer> {
  const settings = settingsForRow(row);
  if (settings.icon) {
    const image = await referencedArtifactForRow(row, settings.icon);
    if (image?.format === 'image') {
      try {
        const stored = await loadImage(image);
        if (stored) {
          // All image detail fits inside the maskable safe circle; no crop surprises.
          const inner = Math.floor(size * 0.56);
          const mark = await sharp(stored.body, { limitInputPixels: 40_000_000 }).rotate().resize(inner, inner, { fit: 'inside' }).png().toBuffer();
          return sharp({ create: { width: size, height: size, channels: 4, background: settings.backgroundColor ?? '#ffffff' } }).composite([{ input: mark, gravity: 'centre' }]).png().toBuffer();
        }
      } catch { /* An unavailable referenced image retains the generated app identity. */ }
    }
  }
  const hash = [...row.id].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
  const tiles = Array.from({ length: 9 }, (_, i) => `<rect x="${146 + (i % 3) * 78}" y="${146 + Math.floor(i / 3) * 78}" width="64" height="64" rx="12" fill="white" opacity="${(hash >>> i) & 1 ? 1 : 0.35}"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="hsl(${hash % 360},50%,35%)"/>${tiles}</svg>`)).resize(size, size).png().toBuffer();
}

export const artifactPwaEnabled = (row: PwaRow): boolean => settingsForRow(row).enabled === true;

/** Discovery belongs to the actual app document, including the compiled reader. */
export function withArtifactAppHead(html: string, row: ArtifactRow): string {
  if (!artifactPwaEnabled(row)) return html;
  const base = escapeAttr(artifactAppPath(row.id));
  const theme = escapeAttr(artifactManifest(row).theme_color);
  return html.replace('</head>', () => `<link data-mx-pwa rel="manifest" href="${base}manifest.webmanifest" crossorigin="use-credentials"><link data-mx-pwa rel="apple-touch-icon" href="${base}icon-192.png"><meta data-mx-pwa name="theme-color" content="${theme}"></head>`);
}
