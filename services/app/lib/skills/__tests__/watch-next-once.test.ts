/**
 * The watch Next line after a publish or a comment reply is printed once, on stderr, as the command's last line, and
 * never inside its JSON (stdout or --output); its text states the order once (reply first, then the watch) and stays
 * short.
 */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterAll, beforeAll, expect, it} from 'vitest';
import {syntheticEnv} from '@/test/helpers/toolbox-env';
import {installSkillScripts, type RunScript} from '@/test/helpers/installed-skill';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {withHttpServer} from '@artifactbin/test-support/net';
import {WATCH_MODE, replyNext, watchNext} from '../../../skills/artifactbin/scripts/toolbox-watch-state.mjs';

const count = (text: string, part: string) => text.split(part).length - 1;
let origin = '', home = '', run: RunScript, close: () => Promise<void>;
const removals: (() => Promise<void>)[] = [];
beforeAll(async () => {
  home = await tempDir('watch-next-', remove => removals.push(remove));
  const server = await withHttpServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const route = new URL(req.url!, 'http://local').pathname;
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && route === '/api/artifacts') {
        res.statusCode = 201;
        return res.end(JSON.stringify({id: 'NEW123', url: `${origin}/a/NEW123`, version: 1, state: 'c'.repeat(64), html: JSON.parse(body).html, format: 'html'}));
      }
      res.end(JSON.stringify({id: 'T1', revision: 8, status: 'open'}));
    });
  });
  origin = server.base;
  close = server.close;
  run = await installSkillScripts(path.join(home, 'installed'), origin);
}, 60000);
afterAll(async () => { await close?.(); for (const remove of removals) await remove(); });
const env = () => syntheticEnv(origin, path.join(home, 'home'));

it('states the order once, reply first, in a short block, and every watch Next line carries it once', () => {
  expect(WATCH_MODE.split(/\s+/).length).toBeLessThanOrEqual(130);
  expect(count(WATCH_MODE, 'Reply to the user first')).toBe(1);
  expect(WATCH_MODE.indexOf('Reply to the user first')).toBe(0);
  expect(WATCH_MODE).not.toMatch(/last message|before (?:you )?reply|then send your reply/i);
  for (const line of [watchNext('PAGE12'), replyNext('PAGE12')]) {
    expect(count(line, WATCH_MODE)).toBe(1);
    expect(line.endsWith('\n  node scripts/comment.mjs watch PAGE12 --next')).toBe(true);
  }
});

it('prints the Next line once, last, on stderr after a comment reply, in text mode, with --json and with --output', async () => {
  const args = ['reply', 'PAGE12', '--thread', 'T1', '--body', 'Done.'];
  for (const extra of [[], ['--json'], ['--output', path.join(home, 'reply.json')]]) {
    const replied = await run('comment.mjs', [...args, ...extra], env());
    expect(replied.code, replied.stderr).toBe(0);
    const json = JSON.parse(extra[0] === '--output' ? await readFile(extra[1]!, 'utf8') : replied.stdout);
    expect(json).toMatchObject({ok: true, thread: {id: 'T1'}});
    expect(json).not.toHaveProperty('next');
    expect(count(replied.stdout + replied.stderr, WATCH_MODE)).toBe(1);
    expect(replied.stderr.endsWith(watchNext('PAGE12') + '\n')).toBe(true);
  }
}, 60000);

it('prints the Next line once after a page publish', async () => {
  const page = path.join(home, 'project', 'index.html');
  await mkdir(path.dirname(page), {recursive: true});
  await writeFile(page, '<!doctype html><html><head><title>Plan</title></head><body><p>Hello</p></body></html>');
  const published = await run('publish.mjs', [page, '--create'], env());
  expect(published.code, published.stderr).toBe(0);
  expect(JSON.parse(published.stdout)).toMatchObject({ok: true, id: 'NEW123'});
  expect(JSON.parse(published.stdout)).not.toHaveProperty('next');
  expect(count(published.stdout + published.stderr, WATCH_MODE)).toBe(1);
  expect(published.stderr.endsWith(watchNext('NEW123') + '\n')).toBe(true);
}, 60000);
