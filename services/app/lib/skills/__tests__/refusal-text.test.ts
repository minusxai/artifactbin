/**
 * A refused request, in text mode, prints the server's own error code and reason for every command (the chart draw
 * included, with no wording of its own), and never the credential the command presented or any bearer value.
 */
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterAll, beforeAll, expect, it} from 'vitest';
import {syntheticEnv} from '@/test/helpers/toolbox-env';
import {installSkillScripts, type RunScript} from '@/test/helpers/installed-skill';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {withHttpServer} from '@artifactbin/test-support/net';

const TOKEN = 'presented-grant-value';
let origin = '', home = '', run: RunScript, close: () => Promise<void>;
const removals: (() => Promise<void>)[] = [];
beforeAll(async () => {
  home = await tempDir('refusal-text-', remove => removals.push(remove));
  const server = await withHttpServer((req, res) => {
    const route = new URL(req.url!, 'http://local').pathname;
    const answer = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (route === '/api/artifacts/DATA12') return answer(200, {format: 'dataset', version: 2});
    if (route === '/api/artifacts/DATA12/query') return answer(200, {results: [{columns: [{name: 'k'}, {name: 'v'}], rows: [{k: 'a', v: 1}], next_cursor: null}]});
    if (route === '/api/charts/image') return answer(400, {error: 'invalid_chart', message: 'unknown recipe "pie"'});
    answer(403, {error: 'forbidden', message: `Only editors may list comments (sent Bearer ${TOKEN} as ${TOKEN}).`, hint: "Ask the owner for access."});
  });
  origin = server.base;
  close = server.close;
  run = await installSkillScripts(path.join(home, 'installed'), origin);
}, 60000);
afterAll(async () => { await close?.(); for (const remove of removals) await remove(); });

const env = () => syntheticEnv(origin, path.join(home, 'home'), {token: TOKEN});

it('prints the code, the server reason and its hint, without the presented token or a bearer value in its reason', async () => {
  const listed = await run('comment.mjs', ['list', 'PAGE12'], env());
  expect(listed).toMatchObject({code: 3, stdout: ''});
  expect(listed.stderr).toBe('forbidden: Request refused (HTTP 403): Only editors may list comments (sent Bearer [redacted] as [redacted]). Ask the owner for access.\n');
}, 30000);

it('prints a refused chart draw the way every command prints a refusal', async () => {
  const spec = path.join(home, 'chart.json');
  await writeFile(spec, JSON.stringify({recipe: 'pie', bindings: {}}));
  const drawn = await run('sql.mjs', ['query', 'DATA12', 'select k, v from rows', '--chart', spec, '--chart-output', path.join(home, 'out.png')], env());
  expect(drawn.code).toBe(1);
  expect(drawn.stderr).toMatch(/^invalid_chart: Request refused \(HTTP 400\): unknown recipe "pie" /);
}, 30000);
