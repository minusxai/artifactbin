/**
 * Internal: sql.mjs query --chart. chartRequest checks the flags and chart file before any query
 * (reads only; --chart-output must be new); drawChart posts {chart, rows, …} to /api/charts/image
 * (the server draws it), at most PAYLOAD_BYTES (toolbox-limits.mjs), and writes the PNG
 * exclusively. Used by: sql.mjs.
 */
import {lstat} from 'node:fs/promises';
import {ToolError, enumValue, exclusive, integer, jsonFile, safeParent} from './toolbox-client.mjs';
import {PAYLOAD_BYTES} from './toolbox-limits.mjs';

const fail = (code, message, exit, recovery) => new ToolError(code, message, exit, recovery);

/** The checked --chart request, or null without one. */
export async function chartRequest(values, sub, write) {
  if (!['chart', 'chart-output', 'chart-width', 'chart-height', 'chart-theme'].some(flag =>
    values[flag] !== undefined)) return null;
  if (sub !== 'query' || write) throw fail('chart_read_only', '--chart draws a read.', 2,
    'Drop --chart for schema and writes.');
  if (!values.chart || !values['chart-output']) throw fail('invalid_arguments',
    '--chart FILE and --chart-output FILE.png go together.', 2, 'Read --help.');
  const chart = await jsonFile(values.chart);
  if (!chart || typeof chart !== 'object' || Array.isArray(chart)) throw fail('invalid_chart',
    '--chart is a JSON object.', 2, 'Write the description <af-chart> takes into the file.');
  const output = await safeParent(values['chart-output']);
  if (await lstat(output).then(() => true, () => false)) throw fail('output_exists',
    'Chart output already exists.', 2, 'Choose a new --chart-output; files are retained.');
  const size = (flag, key, min, max) => values[flag] ? {[key]: integer(values[flag], flag,
    min, max)} : {};
  return {chart, output, shown: values['chart-output'], ...size('chart-width', 'width', 160,
    1600), ...size('chart-height', 'height', 120, 1200), ...values['chart-theme'] ? {theme:
    enumValue(values['chart-theme'], ['light', 'dark'], 'chart-theme')} : {}};
}

/** Draw the read's rows into the request's new PNG. */
export async function drawChart(client, {chart, output, shown, ...size}, {rows}) {
  const body = {chart, rows, ...size}, bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > PAYLOAD_BYTES) throw fail('chart_rows_too_large',
    `The chart request is ${bytes} bytes, past ${PAYLOAD_BYTES}.`, 1,
    'Aggregate in SQL to fewer rows or columns, then draw again.');
  const image = await client.request('/api/charts/image', {method: 'POST', body,
    safeToRepeat: true, timeoutMs: 60000}).catch(error => {
    // The server's reason says what to fix; the transport's names only the status.
    if (typeof error.details?.message === 'string')
      error.message = 'Chart refused: ' + error.details.message;
    throw error;
  });
  const png = Buffer.from(String(image.data), 'base64');
  if (png.length < 8 || png.length !== image.bytes || png.readUInt32BE(0) !== 0x89504e47)
    throw fail('invalid_response', 'The chart answer was not a PNG.', 1, 'Retry once.');
  await exclusive(output, png);
  return {output: shown, width: image.width, height: image.height, bytes: png.length};
}
