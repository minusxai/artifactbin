/** Assemble a portable copy from an admitted page revision and this reader's own readable data. */
import type { HtmlDatasetLink, HtmlPageLink } from '@artifactbin/contracts/html-page';
import type { AccessActor } from '@/lib/accounts';
import { offlinePageSqlData } from '@/lib/dataset-access';
import { OfflineHtmlMediaError, packOfflineHtmlImages } from '@/lib/export';
import { loadBundleAssetResources, publishedFileTable, type PublicationRecord } from '@/lib/html-publication-bundle';
import { withOfflineSystemStyle } from '@/lib/html-systems/server';
import { referencedBoundaryFiles, referencedLibraryResources } from '@/lib/libraries/server';
import { loadImage } from '@/lib/object-store';
import { prepareOfflineDependencies } from '@/lib/offline-dependencies';
import { readableArtifact } from '@/lib/artifacts';
import { nativeHtmlDocument, type NativeHtmlRender } from './native-html.server';

const FILE_MAX_BYTES = 25 * 1024 * 1024;
const SQL_DATA_MAX_BYTES = 16 * 1024 * 1024;
const fits = (html: string) => Buffer.byteLength(html) <= FILE_MAX_BYTES;

type OfflineCopy = { html: string } | { error: 'too_large' | 'unsupported_image' | 'not_found' | 'offline_dependency_unavailable' };

export async function offlineCopy(
  request: Request, actor: AccessActor, row: NativeHtmlRender['row'], appOrigin: string, designSystem: string | null,
): Promise<OfflineCopy> {
  const source = row.source ?? '';
  let packedImages: string;
  try {
    packedImages = await packOfflineHtmlImages({
      html: source,
      admittedIds: ((row.meta as { refs?: Array<{ id: string }> }).refs ?? []).map(ref => ref.id),
      maxBytes: FILE_MAX_BYTES,
      loadImage: async id => {
        const image = (await readableArtifact(actor, id, { admission: 'account', formats: ['image'] }))?.row;
        const stored = image ? await loadImage(image) : null;
        return stored ? { bytes: stored.body, mime: stored.contentType } : null;
      },
    });
  } catch (error) {
    if (!(error instanceof OfflineHtmlMediaError)) throw error;
    return { error: error.reason === 'unsupported_type' ? 'unsupported_image' : error.reason === 'too_large' ? 'too_large' : 'not_found' };
  }

  const { id, version } = row;
  let resources: Awaited<ReturnType<typeof loadBundleAssetResources>>;
  try {
    resources = await loadBundleAssetResources(request, actor, id);
  } catch {
    return { error: 'not_found' };
  }

  // These are the publication assets and platform boundary files a script can fetch by path.
  const published = new Map(resources.map(resource => [resource.url, resource]));
  const boundaries = await referencedBoundaryFiles([
    source, ...resources.filter(resource => /javascript/.test(resource.contentType)).map(resource => Buffer.from(resource.bytes).toString('utf8')),
  ]);
  const files = (embed: boolean) => ({
    ...publishedFileTable(row.meta as PublicationRecord, id, version, receipt => {
      const url = `/a/${id}/assets?dependency=${receipt.id}&revision=${receipt.revision}`;
      const resource = published.get(url);
      if (!resource) return null;
      return embed
        ? dataUrl(resource.contentType.split(';')[0]!.trim() || 'application/octet-stream', resource.bytes)
        : `${appOrigin}${url}&version=${version}`;
    }),
    ...Object.fromEntries(Object.entries(boundaries).map(([url, bytes]) => [
      url, embed ? dataUrl('application/json', bytes) : appOrigin + url,
    ])),
  });

  let renderedHtml: string;
  let dependencies: Awaited<ReturnType<typeof prepareOfflineDependencies>> | undefined;
  try {
    const libraries = await referencedLibraryResources(packedImages, resources, request.url);
    const styled = withOfflineSystemStyle(packedImages, request.url, designSystem);
    const admitted = [...resources, ...libraries, ...styled.resources];
    dependencies = admitted.length
      ? await prepareOfflineDependencies({ html: styled.html, baseUrl: request.url, resources: admitted }, appOrigin)
      : undefined;
    renderedHtml = dependencies?.render(true).html ?? styled.html;
  } catch {
    return { error: 'offline_dependency_unavailable' };
  }

  const links = ((row.meta as { htmlLinks?: readonly HtmlPageLink[] }).htmlLinks ?? [])
    .filter((link): link is HtmlDatasetLink => link.kind === 'dataset');
  const offlineData = await offlinePageSqlData(actor, links, id, SQL_DATA_MAX_BYTES, request.signal).catch(() => null);
  const embeddedFiles = files(true);
  const input = { row, renderedHtml, appOrigin, offline: true, designSystem, files: embeddedFiles, ...(offlineData ? { offlineData } : {}) };
  const hasAddressFallback = dependencies?.hasLinks || Object.keys(embeddedFiles).length > 0;
  const first = await nativeHtmlDocument(input, hasAddressFallback ? undefined : fits);
  if (fits(first.html)) return { html: first.html };
  if (!hasAddressFallback) return { error: 'too_large' };

  // Keep runtime resources embedded. Only file links and the fetch table switch to addresses.
  let linkedHtml = renderedHtml;
  if (dependencies?.hasLinks) {
    try {
      linkedHtml = dependencies.render(false).html;
    } catch {
      return { error: 'offline_dependency_unavailable' };
    }
  }

  const { html } = await nativeHtmlDocument({ ...input, renderedHtml: linkedHtml, files: files(false) }, fits);
  return fits(html) ? { html } : { error: 'too_large' };
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
