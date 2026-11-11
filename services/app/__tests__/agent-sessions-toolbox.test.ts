/**
 * TWO AGENTS ON ONE COMPUTER SHARE ONE SIGN-IN, NOT ONE IDENTITY. Claude Code and Codex run the installed comment
 * command with the same token and sign-in folder, against the real app (createAppServer): each comment shows its own
 * session's name, a watch prints the other agent's comments and never its own, and one agent starting a watch never
 * stops the other's. The server keeps a declared full name ("Claude Code Red"), and the events feed marks `you` per session.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from './harness';
import { nativeHtml } from './native-html-fixture';
import { createAppServer } from '@/server/app';
import { POST as createArtifact } from '@/app/api/artifacts/route';

useAppHarness();
const SERVER = 'http://localhost:3000';
const app = createAppServer({ webDir: 'dist/web' });
const fetcher = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(String(input), init))) as typeof fetch;
const { commentCommand } = await import('../skills/artifactbin/scripts/comment.mjs');
const REPLACED = /took over/;
const dirs: string[] = [];
afterAll(async () => { await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true }))); });

async function twoAgents() {
 const t = await mintAccountToken('two-agents');
 const made = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { html: nativeHtml('<p data-af-id="intro">Read this</p><p data-af-id="outro">Bye</p>') } }));
 expect(made.status).toBe(201);
 const doc = await made.json() as { id: string };
 const dir = await mkdtemp(path.join(tmpdir(), 'two-agents-'));dirs.push(dir);
 const home = path.join(dir, 'home');await mkdir(home);
 const shared = { ARTIFACTBIN_URL: SERVER, ARTIFACTBIN_TOKEN: t.token, ARTIFACTBIN_HOME: home };
 const anchor = async (nodeId: string) => { const file = path.join(dir, `${nodeId}.json`);await writeFile(file, JSON.stringify({ kind: 'html-node', v: 1, nodeId, quote: '' }));return file; };
 const session = (env: Record<string, string>, extra: { as?: string; ps?: () => never } = {}) => {
  const printed: unknown[] = [];
  const options = { env: { ...shared, ...env }, fetcher, retryDelays: [], ps: extra.ps, deliver: async (line: unknown) => { printed.push(line); } };
  const run = (sub: string, values: Record<string, unknown>) => commentCommand({ sub, values: extra.as ? { as: extra.as, ...values } : values, positionals: [doc.id] }, options);
  /** One watch --next call; what it printed: others' comments as their words (read for the event), then its own lines. */
  const watch = async (values: Record<string, unknown> = {}) => { printed.length = 0;await run('watch', { next: true, ...values });return printed.map(v => typeof v === 'string' ? v : (({ event, comment }) => event.type === 'artifact.annotation_reaction_changed' ? `${event.type}:${event.payload.active ? 'added' : 'removed'}` : comment?.body ?? event.type)(v as { event: { type: string; payload: { active?: boolean } }; comment?: { body: string } })); };
  return { run, watch };
 };
 return { doc, anchor, session, a: session({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'claude-session-a' }), b: session({ CODEX_THREAD_ID: 'codex-thread-b' }) };
}

it('two Pi agents whose process tree cannot be read are told apart by the names they pass with --as', async () => {
 const { anchor, session } = await twoAgents();
 const blocked = (): never => { throw new Error('Operation not permitted'); };
 const teal = session({ PI_CODING_AGENT: 'true' }, { as: 'Pi Teal', ps: blocked });
 const rose = session({ PI_CODING_AGENT: 'true' }, { as: 'Pi Rose', ps: blocked });
 const asked = await teal.run('add', { anchor: await anchor('intro'), body: 'Teal asks: is the intro right?' });
 expect(asked.agent).toBe('Pi Teal');
 // Rose's watch prints Teal's question; Rose's answer reaches Teal's watch, and Teal never sees its own.
 expect((await rose.watch()).filter(line => !line.startsWith('next:'))).toEqual(['Teal asks: is the intro right?']);
 await rose.run('reply', { thread: asked.thread.id, body: 'Rose replies: yes' });
 const seen = await teal.watch();
 expect(seen.filter(line => !line.startsWith('next:'))).toEqual(['Rose replies: yes']);
 expect(seen.join('\n')).not.toContain('Teal asks');
}, 60_000);

it('each comment carries its session\'s name, and a watch prints the other agent\'s comments, never its own', async () => {
 const { doc, anchor, a, b } = await twoAgents();
 const mine = await a.run('add', { anchor: await anchor('intro'), body: 'A asks: is the intro right?' });
 const theirs = await b.run('add', { anchor: await anchor('outro'), body: 'B asks: is the outro right?' });
 expect(mine.agent).toMatch(/^Claude Code [A-Z][a-z]+$/);
 expect(theirs.agent).toMatch(/^Codex [A-Z][a-z]+$/);
 const listed = await a.run('list', { json: true }) as { annotations: { thread: { body: string; author: { label: string } }[] }[] };
 expect(Object.fromEntries(listed.annotations.map(t => [t.thread[0]!.body, t.thread[0]!.author.label]))).toEqual({
  'A asks: is the intro right?': mine.agent, 'B asks: is the outro right?': theirs.agent,
 });
 // A's first watch replays the page: B's thread waits for an answer, A's own does not.
 const first = await a.watch();
 expect(first.filter(line => !line.startsWith('next:'))).toEqual(['B asks: is the outro right?']);
 // A answers B; B answers A. A's next watch prints B's reply and never A's own.
 await a.run('reply', { thread: theirs.thread.id, body: 'A replies: yes' });
 await b.run('reply', { thread: mine.thread.id, body: 'B replies: the intro is fine' });
 const second = await a.watch();
 expect(second.filter(line => !line.startsWith('next:'))).toEqual(['B replies: the intro is fine']);
 expect(second.join('\n')).not.toContain('A replies');
 expect(doc.id).toBeTruthy();
}, 60_000);

it('one agent starting its watch never stops the other agent\'s watch on the same page', async () => {
 const { anchor, a, b } = await twoAgents();
 const thread = (await a.run('add', { anchor: await anchor('intro'), body: 'A asks first' })).thread;
 // A's first watch after its own comment returns at once (the reply checkpoint: nobody else has commented, so the reply
 // to the user goes out first); the one that says the reply was sent waits for the next comment.
 expect((await a.watch()).filter(line => !line.startsWith('next:')).join('\n')).toMatch(/^not watching: nobody has commented yet/);
 const waiting = a.watch({ replied: true });
 await new Promise(resolve => setTimeout(resolve, 300));
 // B's first watch replays the page (A's question) and returns; A's watch keeps waiting.
 expect((await b.watch()).filter(line => !line.startsWith('next:'))).toEqual(['A asks first']);
 await b.run('reply', { thread: thread.id, body: 'B answers A' });
 const printed = await waiting;
 expect(printed.some(line => REPLACED.test(line))).toBe(false);
 expect(printed.filter(line => !line.startsWith('next:'))).toEqual(['B answers A']);
}, 60_000);

it('an edit or a reaction by the other agent on the same account reaches the watch; the server marks `you` per session', async () => {
 const { anchor, a, b } = await twoAgents();
 const mine = await a.run('add', { anchor: await anchor('intro'), body: 'A asks' });
 await b.run('add', { anchor: await anchor('outro'), body: 'B asks' });
 expect((await a.watch()).filter(line => !line.startsWith('next:'))).toEqual(['B asks']);
 await a.run('reply', { thread: (await a.run('list', { json: true }) as { annotations: { id: string; thread: { body: string }[] }[] }).annotations.find(t => t.thread[0]!.body === 'B asks')!.id, body: 'A answers' });
 // B, signed in as the same account, rewrites A's question and reacts to it: both are B's, so A sees them.
 await b.run('edit', { comment: mine.thread.id, body: 'A asks (B clarified)' });
 await b.run('react', { comment: mine.thread.id, active: 'true' });
 const printed = (await a.watch()).filter(line => !line.startsWith('next:'));
 expect(printed).toEqual(['A asks (B clarified)', 'artifact.annotation_reaction_changed:added']);
}, 60_000);
