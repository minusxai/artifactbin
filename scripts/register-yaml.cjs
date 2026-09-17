/**
 * Preload for scripts that import lib/ modules outside the bundler: registers a
 * `.yaml` require extension, as @rollup/plugin-yaml does for vitest, so an
 * `import … from '….yaml'` resolves. Used via `tsx -r` in package.json.
 */
const { readFileSync } = require('fs');
const { parse } = require('yaml');

require.extensions['.yaml'] = (module, filename) => {
  module.exports = { __esModule: true, default: parse(readFileSync(filename, 'utf8')) };
};
