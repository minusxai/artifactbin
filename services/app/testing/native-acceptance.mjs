/**
 * THE NATIVE HTML ACCEPTANCE SCENARIO, owned here beside the contract it exercises.
 *
 * The private server repository's post-merge `native-html` job (scripts/accept-native-html.mjs) imports this file
 * from its `toolkit` submodule and runs it against the built production composition; this repository's pr fast
 * contract tier runs the same scenario through the real route handlers (services/app/lib/page-operations/__tests__/native-acceptance.test.ts).
 * A product change to the publish body or the page GraphQL door's built-in viewer therefore fails a product pull
 * request instead of the server's production deploy.
 *
 * Plain dependency-free ESM: Node imports it by path, with no build, alias or TypeScript step.
 */

/** What every page of this scenario shows, before the run's unique suffix. */
export const MARKER_PREFIX = 'native-acceptance-';

/** The page: the run's marker and nothing else; every page answers the built-in viewer. @param {string} marker */
export function acceptanceHtml(marker) {
  return `<!doctype html><html><head><title>Native acceptance</title></head><body><h1>${marker}</h1></body></html>`;
}

/** The authenticated publish request body (`POST /api/artifacts`). @param {string} marker */
export function publishBody(marker) {
  return { html: acceptanceHtml(marker), title: 'Native acceptance', visibility: 'unlisted' };
}

/** The schema discovery (`GET /api/artifacts/:id/graphql`) names the built-in viewer. */
export const SCHEMA_SDL = /\bviewer: Viewer!/;

/**
 * The GraphQL operations, in order, each with the `data` it must answer. `guestRead` is sent without credentials and
 * reads the viewer as nobody; `guestWrite` is sent without credentials and must be refused: an HTTP error or a GraphQL
 * error, never data.
 */
export const OPERATIONS = {
  read: { query: '{viewer{signedIn}}', data: { viewer: { signedIn: true } } },
  guestRead: { query: '{viewer{signedIn id}}', data: { viewer: { signedIn: false, id: null } } },
  guestWrite: { query: 'mutation {viewer{signedIn}}' },
};
