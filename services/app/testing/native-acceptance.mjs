/**
 * THE NATIVE HTML ACCEPTANCE SCENARIO, owned here beside the contract it exercises.
 *
 * The private server repository's post-merge `native-html` job (scripts/accept-native-html.mjs) imports this file
 * from its `toolkit` submodule and runs it against the built production composition; this repository's pr fast
 * contract tier runs the same scenario through the real route handlers (services/app/lib/page-doors/__tests__/native-acceptance.test.ts).
 * A product change to the publish body or the page SQL door therefore fails a product pull
 * request instead of the server's production deploy.
 *
 * Plain dependency-free ESM: Node imports it by path, with no build, alias or TypeScript step.
 */

/** What every page of this scenario shows, before the run's unique suffix. */
export const MARKER_PREFIX = 'native-acceptance-';

/** The page links the run's disposable dataset. @param {string} marker @param {string} datasetId */
export function acceptanceHtml(marker, datasetId) {
  if(!/^[A-Za-z0-9_-]+$/.test(datasetId??''))throw Error('A disposable acceptance dataset is required');
  return `<!doctype html><html><head><title>Native acceptance</title><link rel="af-dataset" data-af-name="data" href="ref:${datasetId}"></head><body><h1>${marker}</h1></body></html>`;
}

/** The authenticated publish request body (`POST /api/artifacts`). @param {string} marker */
export function publishBody(marker, datasetId) {
  return { html: acceptanceHtml(marker, datasetId), title: 'Native acceptance', visibility: 'unlisted' };
}

/** Supported page SQL acceptance requests. */
export const OPERATIONS = {
 read:{sql:'select ready from data',rows:[{ready:1}]},
 guestRead:{sql:'select ready from data',rows:[{ready:1}]},
 guestWrite:{sql:'insert into data(ready) values (2)'},
};
