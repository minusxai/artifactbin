/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Read an artifact as JSON, or save its editable source with --output.
Usage: node scripts/read.mjs ID|URL [--version N] [--output FILE]
       node scripts/read.mjs list [--limit N] [--cursor CURSOR]
Flags: --version N reads a saved version (historical pairs cannot be published back); --output FILE saves the
  canonical source plus FILE.af.json baseline (even with --json); list takes --limit 1-100 (default 20) and
  --cursor. Common: --server ORIGIN, --json, --help.
Examples:
  node scripts/read.mjs ID --output page.html     # edit page.html, then node scripts/publish.mjs page.html
  node scripts/read.mjs ID --json                 # record with html, version and state
  node scripts/read.mjs list --limit 50
Gotchas: --output never overwrites an existing file. HTML pages save as source carrying their data-af-ids;
  datasets save as .json rows; images, files and PDFs save raw bytes. The .af.json companion is credential-free;
  never copy or hand-edit it.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome. Results never contain credentials.`;

import path from 'node:path';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  integer,
  positional,
  exclusive,
  ToolError
} from './toolbox-client.mjs';
import {saveAuthoringPair} from './toolbox-source.mjs';
// read list pages through your artifacts; read ID returns the record, or saves source + baseline with --output.
export async function readCommand({sub = undefined, values, positionals}, options = {}) {
  if (sub === 'list') {
    positional(positionals, 0);
    const client = makeClient(selectedServer(values, options.env), options),
      query = new URLSearchParams();
    if (values.limit) query.set('limit', String(integer(values.limit, 'limit', 1, 100)));
    if (values.cursor) query.set('cursor', values.cursor);
    return await client.request('/api/artifacts?' + query);
  }
  // Resolve the target (ID or URL) against the selected server, then fetch the head or a saved --version.
  const {server, id} = resolveTarget(positional(positionals), selectedServer(values, options.env)),
    client = makeClient(server, options);
  const version = values.version ? integer(values.version, 'version') : undefined;
  const record = await client.request('/api/artifacts/' + id + (version ? '/versions/' + version : ''));
  if (!values.output) return {record};
  // HTML: saveAuthoringPair writes the source (with its data-af-ids) and the FILE.af.json baseline publish needs.
  if (record.format === 'html' || typeof record.html === 'string') {
    const pair = await saveAuthoringPair({
      record: {...record, id},
      server,
      output: values.output,
      historical: !!version
    });
    return {...pair, outputOwned: true};
  }
  // Non-HTML: datasets save as .json rows, images/files/PDFs as raw bytes; anything else has no editable file.
  let bytes;
  if (record.format === 'dataset') {
    if (path.extname(values.output).toLowerCase() !== '.json')
      throw new ToolError(
        'dataset_output_extension',
        'Canonical dataset rows require a .json output path.',
        2
      );
    if (!Array.isArray(record.rows))
      throw new ToolError(
        'dataset_source_unavailable',
        'This saved dataset record does not expose canonical rows.',
        1,
        'Read its JSON record without --output; do not substitute current-head rows.'
      );
    bytes = JSON.stringify(record.rows, null, 2) + '\n';
  } else if (['image', 'file', 'pdf'].includes(record.format)) {
    const raw = await client.request(`/a/${id}/raw${version ? '?version=' + version : ''}`, {raw: true});
    bytes = new Uint8Array(await raw.arrayBuffer());
  } else
    throw new ToolError(
      'unsupported_source_format',
      'This format has no native editable-file contract.',
      2,
      'Read its canonical JSON without --output.'
    );
  // Non-HTML sources retain identity in a credential-free sidecar; no synthetic HTML marker.
  const pair = {
    kind: 'data-baseline',
    schema: 1,
    server,
    id,
    version: record.version,
    state: record.state,
    format: record.format,
    ...(record.contentType ? {contentType: record.contentType} : {}),
    ...(record.filename ? {filename: record.filename} : {}),
    sourceFile: path.basename(values.output),
    historical: !!version
  };
  await exclusive(values.output, bytes);
  await exclusive(values.output + '.af.json', JSON.stringify(pair, null, 2) + '\n');
  return {
    id,
    version: record.version,
    source: path.resolve(values.output),
    baseline: path.resolve(values.output + '.af.json'),
    outputOwned: true
  };
}
await runTool('read', import.meta.url, readCommand);
