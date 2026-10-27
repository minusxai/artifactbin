/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Export a portable HTML copy or a rendered image (not editable source).
Usage: node scripts/export.mjs ID|URL --format html|png|jpg --output FILE [--slide N]
Flags: --format html|png|jpg (required); --output FILE (required, never overwrites); --slide N a
  visible slide number, image formats only (1200x630; the Nth visible data-af-slide element,
  1-based; display:none ones are skipped; a missing slide returns 404 slide_not_found with the
  count; capture hides data-af-deck-chrome). Common: --server ORIGIN, --json, --help.
Examples:
  node scripts/export.mjs ID --format html --output copy.html
  node scripts/export.mjs ID --format png --slide 2 --output slide-2.png
Gotchas: the HTML copy carries credential-free provenance (origin, page ID, saved revision) and
  opens offline; it does not overwrite or publish anything, and merely opening or editing it
  changes nothing on the server. For deck QA the check's slide summary is enough; do not export
  every slide to test layout.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import path from 'node:path';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  requireFlags,
  enumValue,
  integer,
  positional,
  exclusive,
  ToolError
} from './toolbox-client.mjs';
// Read width/height from the PNG header or JPEG frame marker so the receipt can show what was
// captured.
export function imageDimensions(bytes, format) {
  const data = Buffer.from(bytes);
  if (
    format === 'png' &&
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return {width: data.readUInt32BE(16), height: data.readUInt32BE(20)};
  if (format === 'jpg' && data[0] === 255 && data[1] === 216) {
    let i = 2;
    while (i + 8 < data.length) {
      if (data[i++] !== 255) continue;
      const marker = data[i++];
      if (marker === 217 || marker === 218) break;
      const size = data.readUInt16BE(i);
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
        return {height: data.readUInt16BE(i + 3), width: data.readUInt16BE(i + 5)};
      if (size < 2) break;
      i += size;
    }
  }
  throw new ToolError('invalid_image', 'Export did not return a supported image payload.', 1);
}
// html downloads the portable copy; png/jpg render the page (or one slide) on the server.
export async function exportCommand({values, positionals}, options = {}) {
  requireFlags(values, ['format', 'output']);
  const format = enumValue(values.format, ['html', 'png', 'jpg'], 'format');
  if (values.slide && format === 'html')
    throw new ToolError('unsupported_slide', '--slide requires an image format.', 2);
  const {server, id} = resolveTarget(positional(positionals), selectedServer(values, options.env)),
    client = makeClient(server, options);
  const query = new URLSearchParams({format});
  if (values.slide) query.set('slide', String(integer(values.slide, 'slide')));
  const response = await client.request(
    `/a/${id}/${format === 'html' ? 'download' : 'export'}?${query}`, {
    raw: true,
    timeoutMs: 60000
  });
  const bytes = new Uint8Array(await response.arrayBuffer()),
    dimensions = format === 'html' ? {} : imageDimensions(bytes, format);
  if (format === 'html' && !response.headers.get('content-type')?.includes('text/html'))
    throw new ToolError('invalid_export', 'Expected portable HTML.', 1);
  // Exclusive write: an existing output file is never overwritten.
  await exclusive(values.output, bytes);
  return {
    id,
    format,
    output: path.resolve(values.output),
    bytes: bytes.byteLength,
    ...dimensions,
    outputOwned: true
  };
}
await runTool('export', import.meta.url, exportCommand);
