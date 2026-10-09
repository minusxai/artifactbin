/**
 * Where the same-origin `<DeckGL>` basemap proxy answers (app/basemap). The
 * browser rewrites upstream tile URLs onto it, and the document CSP's
 * connect-src admits it.
 */
export const BASEMAP_PATH = '/basemap/';
