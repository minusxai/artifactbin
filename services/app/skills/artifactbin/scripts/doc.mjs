/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Live docs: read a doc's text (a page's editable region) as Markdown
and write it back, safely while people are typing in it: your edit is merged with their unsaved
typing, appears in their open page live and is saved as a new version.
Usage: node scripts/doc.mjs read ID|URL --output doc.md [--region R] [--html]
       node scripts/doc.mjs write doc.md
Flags: read first saves everyone's unsaved typing (when you may edit), then writes the text to
  FILE under a first line, <!-- af-doc:… -->, that records the page, region and version read;
  --region R names a data-af-editable region's data-af-id (default _doc: the page's one rich
  region; a refusal lists the regions); --html reads and writes the region's HTML instead. write
  sends the edited text below that line (never the line) from the version it was read at, then
  rewrites FILE with the merged, saved text: keep editing the same file and keep its first line.
  Common: --server, --json, --help.
Examples:
  node scripts/doc.mjs read ID --output doc.md   # edit doc.md, then
  node scripts/doc.mjs write doc.md
  node scripts/doc.mjs read ID --json            # {regionId, kind, version, markdown}
Gotchas: to change a doc people may be editing, use write, never a whole-page publish. Send the
  whole region back edited in place: text you remove is removed. Markdown keeps headings,
  paragraphs, lists, quotes, code blocks, rules, bold, italic, code and links; images, tables,
  line breaks and raw HTML are refused by name (unsupported_content). Empty paragraphs are not
  kept. region_snapshot_missing: read again into a new file and reapply your edit. After exit 5
  run the same write again: it resumes the saved request and never writes twice.
Exit: 0 ok; 1 failed; 2 invocation or unsupported content; 3 auth/access; 4 read again;
  5 unknown write outcome. Results never contain credentials.`;

import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  positional,
  exclusive,
  createJournal,
  journalIntent,
  resumeJournal,
  platform,
  serverOrigin,
  ToolError
} from './toolbox-client.mjs';
import {noteWatchActivity, watchNext} from './toolbox-watch-state.mjs';

const REGION = /^(?:_doc|[A-Za-z][A-Za-z0-9_-]{0,127})$/;
const MARKER = /^<!-- af-doc:([A-Za-z0-9_-]*) -->\r?\n/;
const withNewline = text => (text && !text.endsWith('\n') ? text + '\n' : text);

/** A refusal said in this command's terms (the shared client's 409 hint is about publishing). */
function explained(error) {
  const listed = (error.details?.regions ?? []).map(region => region.regionId).join(', ');
  const say = (exit, recovery) =>
    new ToolError(error.code, error.message, exit, recovery, error.details);
  if (error.code === 'region_ambiguous' || error.code === 'region_not_found')
    return say(2, `Pass --region with one of: ${listed || '(the page declares no region)'}.`);
  if (error.code === 'region_snapshot_missing')
    return say(4, 'The version you read is gone: doc.mjs read ID --output fresh.md, reapply ' +
      'your edit there and write that file.');
  if (error.code === 'unsupported_content')
    return say(2, 'Remove what details names and write again.');
  return error;
}

async function readRegion(client, id, region, format) {
  // Unsaved typing is saved first, so the version read holds everything typed so far (the server's
  // read does this too). Readers may not save (404): they read the page with its live text.
  try {
    await client.request(`/api/artifacts/${id}/regions/flush`,
      {method: 'POST', safeToRepeat: true});
  } catch (error) {
    if (error.exit !== 3) throw error;
  }
  try {
    return await client.request(`/api/artifacts/${id}/regions/${region}?format=${format}`);
  } catch (error) {
    throw explained(error);
  }
}

/** A doc file: the marker line (page, region, version read, a pending write) and the text.
 * @typedef {import('../../../lib/skills/author-toolbox-contract').DocMarker} DocMarker */
/** @param {DocMarker} marker */
const stamp = (marker, text) => `<!-- af-doc:${Buffer.from(JSON.stringify(marker))
  .toString('base64url')} -->\n${withNewline(text)}`;
async function docFile(file) {
  const bytes = await readFile(file, 'utf8'), found = MARKER.exec(bytes);
  let marker = null;
  try { marker = found && JSON.parse(Buffer.from(found[1], 'base64url').toString()); } catch {}
  if (typeof marker?.server !== 'string' || !/^[A-Za-z0-9]{6,12}$/.test(marker.id) ||
    !REGION.test(marker.regionId) || !['markdown', 'html'].includes(marker.format) ||
    !Number.isSafeInteger(marker.version))
    throw new ToolError('invalid_doc_marker', `${path.basename(file)} does not start with the ` +
      'marker line doc.mjs read wrote, so write cannot tell which doc it edits.', 2, 'Read it ' +
      'again: node scripts/doc.mjs read ID --output fresh.md, reapply your edit there (below its ' +
      'first line) and write that file.');
  return {marker, text: bytes.slice(found[0].length)};
}

export async function docCommand({sub, values, positionals}, options = {}) {
  const {atomicWrite} = await platform();
  if (sub === 'read') {
    const {server, id} =
      resolveTarget(positional(positionals), selectedServer(values, options.env));
    const client = makeClient(server, options);
    const region = values.region ?? '_doc';
    if (!REGION.test(region))
      throw new ToolError('invalid_region', 'A region is a data-af-id or _doc.', 2);
    const format = values.html ? 'html' : 'markdown';
    const reply = await readRegion(client, id, region, format);
    if (!values.output) return reply;
    await exclusive(values.output, stamp({server: client.server, id, regionId: reply.regionId,
      regionKind: reply.kind, format, version: reply.version}, reply[format]));
    return {id, regionId: reply.regionId, version: reply.version,
      file: path.resolve(values.output), outputOwned: true};
  }
  const file = positional(positionals);
  const {marker: pair, text} = await docFile(file);
  const client = makeClient(serverOrigin(selectedServer(values, options.env) ?? pair.server),
    options);
  if (client.server !== pair.server)
    throw new ToolError('marker_origin_mismatch', `${path.basename(file)} was read from ` +
      `${pair.server}, not ${client.server}.`, 2, `Write it with --server ${pair.server}.`);
  // Only the marker line changes until the server answers: the text stays as edited.
  const save = ({pending, ...value}) => atomicWrite(file, stamp(pending ? {...value, pending} :
    value, text));
  // A write whose outcome is unknown stays pending in the marker: the next write resumes it
  // with the same Idempotency-Key, so it can never apply twice.
  let journal = pair.pending;
  if (!journal) {
    journal = await createJournal(journalIntent({server: pair.server, method: 'PUT',
      path: `/api/artifacts/${pair.id}/regions/${pair.regionId}`,
      body: {[pair.format]: text, base_version: pair.version}, operation: 'doc'}),
      {root: client.root});
    await save({...pair, pending: journal});
  }
  let receipt;
  try {
    ({receipt} = await resumeJournal(journal, client, 'doc'));
  } catch (error) {
    if (error.exit !== 5) await save({...pair, pending: undefined});
    throw explained(error);
  }
  // It owes a reply: the page's comment watches restart their quiet time and reply checkpoint.
  await noteWatchActivity(client.root, client.server, pair.id).catch(() => {});
  const {pending: _done, ...read} = pair;
  await atomicWrite(file, stamp({...read, version: receipt.version}, receipt[pair.format] ?? ''));
  return {id: pair.id, regionId: receipt.regionId, version: receipt.version,
    file: path.resolve(file), ...(pair.pending ? {resumed: true} : {}), journal,
    next: watchNext(pair.id)};
}
await runTool('doc', import.meta.url, docCommand);
