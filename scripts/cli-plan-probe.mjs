// Reproduce planning assumptions without importing the application or writing artifacts.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({
  stdin: { contents: `export { parseJsx } from './services/app/lib/jsx/parse';
export { serializeJsx } from './services/app/lib/jsx/serialize';
export { validateJsx } from './services/app/lib/jsx/validate';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
});
const inputs = Object.keys(result.metafile.inputs);
assert.deepEqual(inputs.filter(p => /node_modules\/(react|react-dom|@electric-sql|pg|node-pty)\//.test(p) || /lib\/db\./.test(p)), []);
const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const source = '{/* afbin\nid: abc123\ntitle: Example\n*/}\n<p id="Ab12">A &amp; B</p>';
const parsed = api.parseJsx(source);
assert.equal(parsed.ok, true);
const serialized = api.serializeJsx(parsed.nodes);
assert.equal(serialized.includes('afbin'), false, 'current normalized AST drops the metadata comment');
assert.equal(serialized.includes('id="Ab12"'), true);
assert.equal(serialized.includes('A &amp; B'), true);
console.log(JSON.stringify({ validatorBrowserBundle: 'pass', inputs: inputs.length, bytes: result.outputFiles[0].contents.length, commentHeader: 'parses but is discarded by serialization; must extract and preserve separately', stableNodeId: 'preserved', entities: 'preserved' }, null, 2));
