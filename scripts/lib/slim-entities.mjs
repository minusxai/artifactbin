/**
 * THE SLIM ENTITY DECODER'S WIRING: markdown-it imports the `entities` package (the whole HTML5 table, about 75 KB
 * minified); every build and test runner that bundles services/app/lib/markdown resolves that one import to the
 * module's own decoder (services/app/lib/markdown/entities.ts) instead, so Node and the browser decode the same way.
 * Only an import of bare `entities` made by markdown-it's own files is redirected; any other package keeps its own.
 *
 * - slimEntitiesVite(): a Vite/Vitest plugin. Vitest loads node_modules natively unless they are inlined, so a test
 *   runner also inlines markdown-it (SLIM_ENTITIES_INLINE) for the plugin to reach its imports.
 * - slimEntitiesEsbuild(): the same for an esbuild build.
 *
 * lib/markdown's tests prove the redirect is in place (a rare name stays as typed) in the node and jsdom projects and
 * in an esbuild bundle of the display entry.
 */
import { fileURLToPath } from 'node:url';

export const SLIM_ENTITIES = fileURLToPath(new URL('../../services/app/lib/markdown/entities.ts', import.meta.url));
const MARKDOWN_IT = /[\\/]node_modules[\\/]markdown-it[\\/]/;
const redirect = (specifier, importer) => specifier === 'entities' && !!importer && MARKDOWN_IT.test(importer);

/** markdown-it's files, for a Vitest `server.deps.inline` list. */
export const SLIM_ENTITIES_INLINE = [MARKDOWN_IT];

/** @returns {import('vite').Plugin} */
export const slimEntitiesVite = () => ({
  name: 'artifactbin-slim-entities',
  enforce: 'pre',
  resolveId: (specifier, importer) => (redirect(specifier, importer) ? SLIM_ENTITIES : null),
});

/** @returns {import('esbuild').Plugin} */
export const slimEntitiesEsbuild = () => ({
  name: 'artifactbin-slim-entities',
  setup(build) {
    build.onResolve({ filter: /^entities$/ }, args => (redirect(args.path, args.importer) ? { path: SLIM_ENTITIES } : undefined));
  },
});
