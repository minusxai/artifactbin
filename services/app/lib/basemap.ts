/**
 * The `<DeckGL>` street basemap: OpenFreeMap vector tiles, reached through the
 * same-origin `/basemap/` proxy (app/basemap). A served document may only fetch
 * from 'self' (lib/story/markup-csp), so the browser rewrites every upstream URL
 * the style names onto the proxy, and the proxy forwards only this allowlist.
 */
export const BASEMAP_UPSTREAM = 'https://tiles.openfreemap.org';
/** Where the proxy answers; also admitted by the document CSP's connect-src. */
export const BASEMAP_PATH = '/basemap/';
/** MapLibre's CSP-build worker, served same-origin: a blob: worker is refused. */
export const BASEMAP_WORKER_URL = `${BASEMAP_PATH}worker.js`;

/** The two OpenFreeMap styles a map uses: light ("positron") and dark. */
const STYLES = { light: 'positron', dark: 'dark' } as const;

/** Upstream paths the proxy forwards. Anything else is a 404 — never an open proxy. */
export const BASEMAP_ALLOWED: readonly RegExp[] = [
  /^styles\/(positron|dark)$/,
  /^planet$/,
  /^planet\/[\w-]+\/\d{1,2}\/\d{1,7}\/\d{1,7}\.pbf$/,
  /^fonts\/[\w %,-]+\/\d{1,5}-\d{1,5}\.pbf$/,
  /^sprites\/ofm_f384\/ofm(@2x)?\.(json|png)$/,
  /^natural_earth\/ne2sr\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/,
];

/** The absolute style URL for a theme (MapLibre wants an absolute URL). */
export function basemapStyleUrl(mode: 'light' | 'dark'): string {
  return `${location.origin}${BASEMAP_PATH}styles/${STYLES[mode]}`;
}

/** MapLibre's transformRequest: every upstream URL the style names, onto the proxy. */
export function basemapTransformRequest(url: string): { url: string } {
  return { url: url.startsWith(BASEMAP_UPSTREAM + '/') ? `${location.origin}${BASEMAP_PATH}${url.slice(BASEMAP_UPSTREAM.length + 1)}` : url };
}
