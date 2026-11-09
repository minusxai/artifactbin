import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
/**
 * EVERY AGENT SESSION HAS A NAME. The installed scripts name the harness and its session on every request
 * (Artifactbin-Agent, Artifactbin-Session), derive "<product> <colour>" deterministically from the session, keep a name
 * chosen with --as for that session, and every comment write prints that name and the watch to run next.
 */
const agent = await import('../../../skills/artifactbin/scripts/toolbox-agent.mjs');
const {commentCommand} = await import('../../../skills/artifactbin/scripts/comment.mjs');
const roots: string[] = [];
const home = async () => { const root = await mkdtemp(path.join(tmpdir(), 'agent-identity-')); roots.push(root); return root; };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))); });
const noPs = () => { throw new Error('no ps for a harness with its own session ID'); };

it('detects each harness and the session key it exposes', () => {
 expect(agent.detectSession({CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'c1'}, {ps: noPs})).toEqual({harness: 'claude-code', label: 'Claude Code', key: 'c1'});
 expect(agent.detectSession({CODEX_THREAD_ID: 't1'}, {ps: noPs})).toEqual({harness: 'codex', label: 'Codex', key: 't1'});
 expect(agent.detectSession({OPENCODE: '1', OPENCODE_PID: '42'}, {ps: noPs})).toEqual({harness: 'opencode', label: 'OpenCode', key: '42'});
 // Pi exposes no session ID: the nearest ancestor that is not a shell or wrapper, with its start time, is the session.
 const tree: Record<number, {ppid: number; started: string; command: string}> = {
  10: {ppid: 9, started: 'Mon Nov  9 10:00:01 2026', command: '/bin/bash'},
  9: {ppid: 8, started: 'Mon Nov  9 10:00:01 2026', command: '/usr/bin/timeout'},
  8: {ppid: 1, started: 'Mon Nov  9 09:00:00 2026', command: '/usr/local/bin/node'},
 };
 expect(agent.detectSession({PI_CODING_AGENT: 'true'}, {ps: (pid: number) => tree[pid] ?? null, ppid: 10}))
  .toEqual({harness: 'pi', label: 'Pi', key: '8@Mon Nov  9 09:00:00 2026'});
 expect(agent.detectSession({}, {ps: (pid: number) => tree[pid] ?? null, ppid: 10})).toEqual({harness: null, label: null, key: '8@Mon Nov  9 09:00:00 2026'});
 // The same agent process is the same session on every call; ps failing still yields a key.
 expect(agent.ancestorKey(10, (pid: number) => tree[pid] ?? null)).toBe(agent.ancestorKey(10, (pid: number) => tree[pid] ?? null));
 // No process table (ps refused in a sandbox): no key at all, never the shell's own pid.
 expect(agent.ancestorKey(77, () => { throw new Error('no ps'); })).toBeNull();
});

it('a session whose process tree cannot be read stays one identity across commands: no session key, so its own comments stay its own', async () => {
 const root = await home();
 const noPs = () => { throw new Error('Operation not permitted'); };
 // Each command runs under a fresh shell: a different parent pid every time.
 const first = agent.agentIdentity({env: {PI_CODING_AGENT: 'true'}, root, ps: noPs, ppid: 4001, save: true});
 const second = agent.agentIdentity({env: {PI_CODING_AGENT: 'true'}, root, ps: noPs, ppid: 4002});
 expect(first.session).toBeNull();
 expect(second).toMatchObject({name: first.name, session: null, source: 'derived'});
 expect(first.name).toMatch(/^Pi [A-Z][a-z]+$/);
 expect(agent.agentHeaders(first)).toEqual({'Artifactbin-Agent': first.name});
});

it('an unidentifiable session named with --as is told apart by that name: one key per name, never saved for another session', async () => {
 const root = await home();
 const noPs = () => { throw new Error('Operation not permitted'); };
 const pi = (as: string | undefined, ppid: number) =>
  agent.agentIdentity({env: {PI_CODING_AGENT: 'true'}, root, ps: noPs, ppid, as, save: true});
 const tealFirst = pi('Pi Teal', 5001), tealAgain = pi('Pi Teal', 5002), rose = pi('Pi Rose', 5003);
 expect(tealFirst.session).toMatch(/^[0-9a-f]{32}$/);
 expect(tealAgain.session).toBe(tealFirst.session);
 expect(rose.session).not.toBe(tealFirst.session);
 expect(agent.agentHeaders(rose)).toEqual({'Artifactbin-Agent': 'Pi Rose', 'Artifactbin-Session': rose.session});
 // Another Pi session on this computer, unnamed, never inherits a name one of them chose.
 const unnamed = pi(undefined, 5004);
 expect(unnamed).toMatchObject({session: null, source: 'derived'});
 expect(['Pi Teal', 'Pi Rose']).not.toContain(unnamed.name);
 expect(agent.nameNote(unnamed)).toMatch(/cannot be told apart.*same --as "Pi [A-Z][a-z]+" on every comment\.mjs command, watch included/);
 expect(agent.nameNote(tealAgain)).toMatch(/same --as "Pi Teal" on every comment\.mjs command, watch included/);
});

it('derives "<product> <colour>" deterministically per session, an animal for an unknown harness, never "Agent"', () => {
 const a = {harness: 'claude-code', label: 'Claude Code', key: 'session-a'};
 const name = agent.derivedName(a);
 expect(name).toMatch(new RegExp(`^Claude Code (${agent.COLOURS.join('|')})$`));
 expect(agent.derivedName({...a})).toBe(name);
 const names = new Set(Array.from({length: 40}, (_, i) => agent.derivedName({...a, key: `s${i}`})));
 expect(names.size).toBeGreaterThan(8);
 // A colour another session in this sign-in folder already shows is skipped.
 expect(agent.derivedName(a, new Set([name]))).not.toBe(name);
 const unknown = agent.derivedName({harness: null, label: null, key: 'x'});
 expect(unknown).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
 expect(unknown).not.toMatch(/Agent/);
 // The session key never leaves raw: the header carries a hash.
 expect(agent.sessionId(a)).toMatch(/^[0-9a-f]{32}$/);
 expect(agent.sessionId(a)).not.toContain('session-a');
});

it('keeps a name chosen with --as for its session only; ARTIFACTBIN_AGENT_NAME names it per process', async () => {
 const root = await home();
 const a = {CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'session-a'}, b = {CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'session-b'};
 const derived = agent.agentIdentity({env: a, root, save: true});
 expect(derived).toMatchObject({source: 'derived', harness: 'claude-code'});
 expect(agent.agentIdentity({env: b, root}).name).not.toBe(derived.name);
 expect(agent.agentIdentity({env: a, root, as: 'Claude Code Reviewer', save: true})).toMatchObject({name: 'Claude Code Reviewer', source: 'as'});
 expect(agent.agentIdentity({env: a, root})).toMatchObject({name: 'Claude Code Reviewer', source: 'saved'});
 expect(agent.agentIdentity({env: {...a, ARTIFACTBIN_AGENT_NAME: 'Night Shift'}, root})).toMatchObject({name: 'Night Shift', source: 'env'});
 expect(agent.agentIdentity({env: b, root}).name).toMatch(/^Claude Code /);
 for (const bad of ['', 'x'.repeat(65), 'Claude ✨']) expect(() => agent.agentIdentity({env: a, root, as: bad})).toThrow(expect.objectContaining({code: 'invalid_agent_name', exit: 2}));
 expect(agent.nameNote({name: 'Red Fox', harness: null})).toContain('--as "<your product> <Colour>"');
});

it('names the session on every request, and every comment write prints the name and the watch to run next', async () => {
 const root = await home();
 const calls: {url: string; headers: Headers}[] = [];
 const fetcher = async (url: any, init: any) => {
  calls.push({url: String(url), headers: new Headers(init.headers)});
  if (String(url).includes('status=all')) return Response.json({annotations: [{id: 'ann_root', revision: 2, thread: [{id: 'ann_root'}]}], next_cursor: null});
  return String(url).endsWith('/PAGE12') ? Response.json({id: 'PAGE12', version: 3}) : Response.json({id: 'ann_root', revision: 2, thread: []});
 };
 const env = {ARTIFACTBIN_URL: 'https://example.test', ARTIFACTBIN_TOKEN: 'synthetic', ARTIFACTBIN_HOME: root, CODEX_THREAD_ID: 'thread-1'};
 const {writeFile} = await import('node:fs/promises');
 const anchor = path.join(root, 'anchor.json');
 await writeFile(anchor, JSON.stringify({kind: 'html-node', v: 1, nodeId: 'intro', quote: ''}));
 const watchLine = '\n  node scripts/comment.mjs watch PAGE12 --next';
 const writes: [string, Record<string, unknown>][] = [
  ['add', {anchor, body: 'Should this say Q3?'}],
  ['reply', {thread: 'ann_root', body: 'Done'}],
  ['edit', {comment: 'ann_root', body: 'Should this say Q4?'}],
  ['react', {comment: 'ann_root', active: 'true'}],
 ];
 for (const [sub, values] of writes) {
  const result = await commentCommand({sub, values, positionals: ['PAGE12']}, {env, fetcher});
  expect(result.next, sub).toMatch(/^Next: when the request is done, reply to the user/);
  expect(result.next.endsWith(watchLine), sub).toBe(true);
  expect(result.agent, sub).toMatch(/^Codex [A-Z][a-z]+$/);
  expect(result.note, sub).toContain(`Comments show you as "${result.agent}"`);
 }
 const resolved = await commentCommand({sub: 'resolve', values: {thread: 'ann_root'}, positionals: ['PAGE12']}, {env, fetcher});
 expect(resolved.next).toBeUndefined();
 const names = new Set(calls.map(call => call.headers.get('Artifactbin-Agent')));
 expect([...names]).toHaveLength(1);
 expect([...names][0]).toMatch(/^Codex /);
 expect(new Set(calls.map(call => call.headers.get('Artifactbin-Session'))).size).toBe(1);
 expect(calls[0]!.headers.get('Artifactbin-Session')).toMatch(/^[0-9a-f]{32}$/);
 // --as renames this session from now on.
 const renamed = await commentCommand({sub: 'reply', values: {thread: 'ann_root', body: 'Again', as: 'Codex Reviewer'}, positionals: ['PAGE12']}, {env, fetcher});
 expect(renamed.agent).toBe('Codex Reviewer');
 expect(calls.at(-1)!.headers.get('Artifactbin-Agent')).toBe('Codex Reviewer');
 const after = await commentCommand({sub: 'reply', values: {thread: 'ann_root', body: 'Once more'}, positionals: ['PAGE12']}, {env, fetcher});
 expect(after.agent).toBe('Codex Reviewer');
});
