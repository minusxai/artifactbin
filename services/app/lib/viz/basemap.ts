/**
 * The `<DeckGL>` street basemap: OpenFreeMap vector tiles, reached through the
 * same-origin `/basemap/` proxy (app/basemap). A served document may only fetch
 * from 'self' (lib/page-styles/markup-csp), so the browser rewrites every upstream URL
 * the style names onto the proxy, and the proxy forwards only this allowlist.
 */
import { BASEMAP_PATH } from '@artifactbin/contracts/basemap';

export const BASEMAP_UPSTREAM = 'https://tiles.openfreemap.org';
/** MapLibre's module worker, served same-origin: a blob: worker is refused. */
export const BASEMAP_WORKER_URL = `${BASEMAP_PATH}worker.mjs`;

/** Upstream paths the proxy forwards. Anything else is a 404 — never an open proxy. */
export const BASEMAP_ALLOWED: readonly RegExp[] = [
  /^styles\/(positron|dark)$/,
  /^planet$/,
  /^planet\/[\w-]+\/\d{1,2}\/\d{1,7}\/\d{1,7}\.pbf$/,
  /^fonts\/[\w %,-]+\/\d{1,5}-\d{1,5}\.pbf$/,
  /^sprites\/ofm_f384\/ofm(@2x)?\.(json|png)$/,
  /^natural_earth\/ne2sr\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/,
];
