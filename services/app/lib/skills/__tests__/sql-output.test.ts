/** sql.mjs query --sql-file and --output: rows go from the read into a new file and only a summary is printed. */
import {readFile, writeFile, realpath} from 'node:fs/promises';
import {syntheticEnv} from '@/test/helpers/toolbox-env';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {beforeEach, expect, it, onTestFinished} from 'vitest';
import {sqlCommand} from '../../../skills/artifactbin/scripts/sql.mjs';
import {tempDir} from '@artifactbin/test-support/temp-dir';

const columns = [{name: 'month'}, {name: 'region'}, {name: 'note'}, {name: 'revenue'}];
const rows = Array.from({length: 8}, (_, i) => ({month: `2026-0${i + 1}`, region: i % 2 ? 'east' : 'west',
  note: i === 0 ? 'say "hi", then\nleave' : i === 1 ? 'x'.repeat(100) : i === 2 ? null : 'plain', revenue: 100 + i}));
let root: string, sent: {route: string; body: any}[];
const options = () => ({env: syntheticEnv('https://example.test',root),
  fetcher: async (url: string, init: RequestInit) => {
    const route = new URL(url).pathname;
    sent.push({route, body: init.body ? JSON.parse(String(init.body)) : undefined});
    if (route === '/api/artifacts/DATA12') return Response.json({format: 'dataset', version: 2});
    if (route === '/api/artifacts/PAGE12') return Response.json({format: 'html', version: 3});
    if (route === '/api/artifacts/DATA12/query') return Response.json({results: [{columns, rows, next_cursor: null}]});
    if (route === '/api/artifacts/PAGE12/sql') return Response.json({columns, rows});
    if (route === '/api/default-connection/sql') {
      const limit = sent.at(-1)!.body.limit ?? rows.length;
      return Response.json({columns, rows: rows.slice(0, limit), truncated: true});
    }
    return Response.json({error: 'not_found'}, {status: 404});
  }});
const query = (target: string, sql: string | undefined, values: Record<string, unknown>): Promise<any> =>
  sqlCommand({sub: 'query', values, positionals: sql === undefined ? [target] : [target, sql]}, options());
beforeEach(async () => { root = await tempDir('sql-output-',onTestFinished); sent = []; });

it('sends --limit to the default connection and preserves its truncated marker', async () => {
  const sql = 'select * from monthly';
  expect(await query('default:wh', sql, {limit: '2'})).toEqual({
    columns, rows: rows.slice(0, 2), truncated: true,
  });
  expect(sent).toEqual([{route: '/api/default-connection/sql', body: {sql, namespace: 'wh', limit: 2}}]);
});

it('writes every row of a read to a new CSV and prints the count, columns and a cut sample instead', async () => {
  const out = path.join(root, 'monthly.csv');
  const read = await query('default:wh', 'select * from monthly', {output: out});
  expect(read).not.toHaveProperty('rows');
  expect(read).toMatchObject({columns, rowCount: 8, truncated: true, output: {file: out, format: 'csv'}});
  expect(read.sample).toHaveLength(5);
  expect(read.sample[1].note).toBe('x'.repeat(60) + '…');
  expect(read.sample[0].note).toBe(rows[0]!.note);
  const csv = await readFile(out, 'utf8');
  expect(read.output.bytes).toBe(Buffer.byteLength(csv));
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('month,region,note,revenue');
  expect(csv).toContain('2026-01,west,"say ""hi"", then\nleave",100\r\n');
  expect(lines).toContain(`2026-02,east,${'x'.repeat(100)},101`);
  expect(lines).toContain('2026-03,west,,102');
  expect(csv.endsWith('2026-08,east,plain,107\r\n')).toBe(true);
});

it('writes JSON, takes the statement from --sql-file, and works for page and dataset reads', async () => {
  const sql = path.join(root, 'q.sql');
  await writeFile(sql, "select month, revenue from rows where region = 'east'\n");
  const out = path.join(root, 'rows.json');
  const read = await query('DATA12', undefined, {'sql-file': sql, output: out});
  expect(sent.at(-1)!.body.sql).toBe("select month, revenue from rows where region = 'east'\n");
  expect(read).toMatchObject({rowCount: 8, output: {file: out, format: 'json'}});
  expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({columns, rows});
  const page = await query('PAGE12', 'select * from t', {output: path.join(root, 'page.csv')});
  expect(page).toMatchObject({rowCount: 8, output: {format: 'csv'}});
  expect(await query('PAGE12', 'select * from t', {})).toMatchObject({rows});
});

it('refuses what it cannot save before querying', async () => {
  const out = path.join(root, 'taken.csv'), sql = path.join(root, 'q.sql');
  await writeFile(out, 'old');
  await writeFile(sql, 'select 1');
  await expect(query('DATA12', 'select 1', {output: out})).rejects.toMatchObject({code: 'output_exists', exit: 2});
  await expect(query('DATA12', 'select 1', {output: path.join(root, 'rows.txt')})).rejects.toMatchObject({code: 'invalid_output', exit: 2});
  for (const [target, write] of [['DATA12', 'insert into rows (k) values (1)'], ['PAGE12', 'delete from t'], ['default:wh', 'update t set v = 1']])
    await expect(query(target!, write!, {output: path.join(root, 'w.csv')})).rejects.toMatchObject({code: 'output_read_only', exit: 2});
  await expect(sqlCommand({sub: 'schema', values: {output: path.join(root, 's.csv')}, positionals: ['DATA12']}, options()))
    .rejects.toMatchObject({code: 'output_read_only'});
  await expect(query('DATA12', 'select 1', {'sql-file': sql})).rejects.toMatchObject({code: 'invalid_arguments', exit: 2});
  await expect(query('DATA12', undefined, {'sql-file': path.join(root, 'missing.sql')})).rejects.toMatchObject({code: 'invalid_sql_file', exit: 2});
  await writeFile(sql, '  \n');
  await expect(query('DATA12', undefined, {'sql-file': sql})).rejects.toMatchObject({code: 'invalid_sql_file'});
  expect(sent).toEqual([]);
  expect(await readFile(out, 'utf8')).toBe('old');
});

it('through runTool, the rows file stays the command\'s own and the summary is printed', async () => {
  const {runTool} = await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
  const out = path.join(root, 'rows.csv'), argv = process.argv[1];
  await writeFile(path.join(root, 'sql.mjs'), '');
  const entry = await realpath(path.join(root, 'sql.mjs'));
  let printed = '';
  const write = process.stdout.write.bind(process.stdout);
  process.argv[1] = entry;
  process.stdout.write = ((text: string) => { printed += text; return true; }) as typeof process.stdout.write;
  try {
    await runTool('sql', pathToFileURL(entry).href, (parsed: any) => sqlCommand(parsed, options()),
      ['query', 'default:wh', 'select * from monthly', '--output', out, '--json', '--no-update']);
  } finally { process.stdout.write = write; process.argv[1] = argv; }
  const summary = JSON.parse(printed);
  expect(summary).toMatchObject({ok: true, rowCount: 8, output: {format: 'csv'}});
  expect(summary).not.toHaveProperty('rows');
  expect((await readFile(out, 'utf8')).split('\r\n')[0]).toBe('month,region,note,revenue');
});
