/**
 * THE NATIVE HTML ACCEPTANCE SCENARIO, owned here beside the contract it exercises.
 *
 * minusxai/artifactbin-server's post-merge `native-html` job (scripts/accept-native-html.mjs) imports this file from
 * its `toolkit` submodule and runs it against the built production composition; this repository's pr fast guard
 * tier runs the same scenario through the real route handlers (services/app/lib/html-backends/__tests__/
 * native-acceptance.test.ts). A product change to the publish body, the resolver link, the resolver module format or
 * roles therefore fails a product pull request instead of the server's production deploy.
 *
 * Plain dependency-free ESM: Node imports it by path, with no build, alias or TypeScript step.
 */

/** The resolver's name: its `data-af-name`, its `resolverSources` key and its GraphQL root field. */
export const RESOLVER_NAME = 'counter';

/** What every page of this scenario shows, before the run's unique suffix. */
export const MARKER_PREFIX = 'native-acceptance-';

/** Ambient authority a resolver isolate must not see: process, require, fetch, document, then three Node modules. */
export const ISOLATION = 'undefined,undefined,undefined,undefined,denied,denied,denied';

/** The resolver module: a read, an isolation probe and an owner-only mutation. */
export const RESOLVER_SOURCE = `export const typeDefs=\`type Query { count:Int! isolation:String! } type Mutation { increment(n:Int!):Int! @auth(role:owner) }\`;export default {count:()=>0,isolation:()=>[typeof process,typeof globalThis.require,typeof fetch,typeof document,...['node:fs','node:process','node:child_process'].map(name=>{try{require(name);return 'allowed';}catch{return 'denied';}})].join(','),increment:(a)=>a.n+1};`;

/** The page: one resolver link and the run's marker. @param {string} marker */
export function acceptanceHtml(marker) {
  return `<!doctype html><html><head><title>Native acceptance</title><link rel="af-resolver" data-af-name="${RESOLVER_NAME}" href="./${RESOLVER_NAME}.ts"></head><body><h1>${marker}</h1></body></html>`;
}

/** The authenticated publish request body (`POST /api/artifacts`). @param {string} marker */
export function publishBody(marker) {
  return { html: acceptanceHtml(marker), title: 'Native acceptance', visibility: 'unlisted', resolverSources: { [RESOLVER_NAME]: RESOLVER_SOURCE } };
}

/** The schema discovery (`GET /api/artifacts/:id/graphql`) names the resolver. */
export const SCHEMA_SDL = new RegExp(RESOLVER_NAME);

/**
 * The GraphQL operations, in order, each with the `data` it must answer. `guestWrite` is sent without credentials
 * and must be refused: an HTTP error or a GraphQL error, never data.
 */
export const OPERATIONS = {
  read: { query: `{${RESOLVER_NAME}{count isolation}}`, data: { [RESOLVER_NAME]: { count: 0, isolation: ISOLATION } } },
  ownerWrite: { query: `mutation {${RESOLVER_NAME}{increment(n:1)}}`, data: { [RESOLVER_NAME]: { increment: 2 } } },
  guestWrite: { query: `mutation {${RESOLVER_NAME}{increment(n:1)}}` },
};
