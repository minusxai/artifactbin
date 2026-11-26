/**
 * Internal: sql.mjs query --sql-file, --limit and --output. statementOf reads the SQL from a file
 * instead of the command line; readLimit checks --limit (a printed read at most 10,000 rows, a
 * default:DB read saved with --output at most 100,000); outputRequest checks --output before any
 * query (reads only; a new .csv or .json file); writeRows writes every row of the read there
 * exclusively and answers a summary in place of the rows: their count, the columns and a few rows
 * with long values cut, so the rows reach the file without passing through the caller.
 * Used by: sql.mjs.
 */
import {lstat, readFile} from 'node:fs/promises';
import {ToolError, exclusive, integer, safeParent} from './toolbox-client.mjs';

const SAMPLE = 5, CELL = 60;
const fail = (code, message, exit, recovery) => new ToolError(code, message, exit, recovery);

/** The positional SQL, or the --sql-file's text; exactly one of them. */
export async function statementOf(values, sub, positional) {
  if (values['sql-file'] === undefined) return positional;
  if (sub !== 'query' || positional !== undefined) throw fail('invalid_arguments',
    'query takes its SQL from the command line or --sql-file, not both.', 2, 'Read --help.');
  const sql = await readFile(values['sql-file'], 'utf8').catch(() => {
    throw fail('invalid_sql_file', 'Cannot read --sql-file.', 2, 'Provide a readable file.');
  });
  if (!sql.trim()) throw fail('invalid_sql_file', '--sql-file is empty.', 2,
    'Write one SQL statement into the file.');
  return sql;
}

/** Rows a read returns by default, printed at most, and saved from default:DB with --output. */
export const ROWS = Object.freeze({default: 1000, printed: 10000, saved: 100000});
/** The checked --limit and the most this read may ask for. */
export function readLimit(value, saved, target) {
  const most = saved && target.startsWith('default:') ? ROWS.saved : ROWS.printed;
  const limit = value === undefined ? ROWS.default : integer(value, 'limit', 1,
    most === ROWS.saved ? most : Infinity);
  if (limit > most) throw fail('limit_too_large', `This read returns at most ${most} rows.`, 2,
    saved ? `Only a default:DB read saves up to ${ROWS.saved} rows with --output.` :
      `Add --output FILE.csv to save up to ${ROWS.saved} rows of a default:DB read.`);
  return {limit, most};
}

/** The checked --output request, or null without one. */
export async function outputRequest(values, sub, write) {
  if (values.output === undefined) return null;
  if (sub !== 'query' || write) throw fail('output_read_only', '--output saves a read.', 2,
    'Drop --output for schema and writes.');
  const format = /\.(csv|json)$/i.exec(values.output)?.[1]?.toLowerCase();
  if (!format) throw fail('invalid_output', '--output is a .csv or .json file.', 2,
    'Name the file NAME.csv or NAME.json.');
  const output = await safeParent(values.output);
  if (await lstat(output).then(() => true, () => false)) throw fail('output_exists',
    'Output already exists.', 2, 'Choose a new --output, or remove the old file first.');
  return {output, shown: values.output, format};
}

const text = value => value === null || value === undefined ? '' :
  typeof value === 'object' ? JSON.stringify(value) : String(value);
const cell = value => {
  const s = text(value);
  return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
};
const cut = value => typeof value === 'string' && value.length > CELL ?
  value.slice(0, CELL) + '…' : value;

/** Every row as RFC 4180 CSV under a header of the column names. */
export function csvOf(columns, rows) {
  const names = columns.length ? columns.map(c => c.name) : Object.keys(rows[0] ?? {});
  return [names, ...rows.map(row => names.map(name => row[name]))]
    .map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Write the read's rows into the request's new file; answer the summary that replaces them. */
export async function writeRows({output, shown, format}, {rows, ...read}) {
  const bytes = Buffer.from(format === 'csv' ? csvOf(read.columns ?? [], rows) :
    JSON.stringify({columns: read.columns ?? [], rows, ...read.truncated ? {truncated: true} :
      {}}) + '\n');
  await exclusive(output, bytes);
  return {...read, rowCount: rows.length, sample: rows.slice(0, SAMPLE).map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, cut(v)]))),
  output: {file: shown, format, bytes: bytes.length}, outputOwned: true};
}
