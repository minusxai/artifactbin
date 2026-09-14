import { sessionRequest } from './session-redirects';
import { createSessionRequestQueue } from './session-request-queue';
import { createSessionResources } from './session-resources';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import type { Actor, BrowserSessionResult } from '@artifactbin/contracts';
import { BROWSER_SESSION_HEADER, SESSION_LIMITS } from '@artifactbin/contracts';
import { SESSION_WORKER_SOURCE } from './session-worker';
import type { SessionWorker } from './sessions';

export interface SessionProcessOptions {
  baseURL: string;
  /** Trusted actor forwarding stays in the parent; no credential enters the worker. */
  request(request: Request, actor: Actor): Promise<Response>;
  browsersPath?: string;
  cgroupRoot?: string;
}
const require = createRequire(import.meta.url);

/** Linux namespace isolation is mandatory. Unsupported hosts fail closed. */
export async function createSessionProcess(actor: Actor, options: SessionProcessOptions): Promise<SessionWorker> {
  if (process.platform !== 'linux' || !existsSync('/usr/bin/bwrap')) throw new Error('Browser sessions require Linux with bubblewrap and unprivileged user namespaces');
  const resources = await createSessionResources(options.cgroupRoot ?? '/sys/fs/cgroup/afbin-sessions');
  const root = await mkdtemp(path.join(tmpdir(), 'afbin-session-'));
  let child: ChildProcess | undefined;
  let stopped = false;
  const requests = createSessionRequestQueue();
  const closedListeners = new Set<() => void>();
  const close = async () => {
    if (stopped) return;
    stopped = true;
    requests.close();
    for (const listener of closedListeners) listener();
    closedListeners.clear();
    if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    try { await resources.close(); } finally { await rm(root, { recursive: true, force: true }); }
  };
  try {
    for (const name of ['playwright', 'playwright-core']) {
      const source = path.dirname(require.resolve(`${name}/package.json`));
      await cp(source, path.join(root, 'node_modules', name), { recursive: true, dereference: true });
    }
    await mkdir(path.join(root, 'home'));
    await writeFile(path.join(root, 'worker.mjs'), SESSION_WORKER_SOURCE);
    const browsers = await realpath(options.browsersPath ?? path.join(homedir(), '.cache/ms-playwright'));
    const args = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home/session'];
    for (const dir of ['/usr', '/bin', '/lib', '/lib64', '/etc/fonts', '/etc/ld.so.cache']) if (existsSync(dir)) args.push('--ro-bind', dir, dir);
    const node = await realpath(process.execPath);
    if (!node.startsWith('/usr/') && !node.startsWith('/bin/')) args.push('--ro-bind', path.dirname(node), path.dirname(node));
    args.push('--ro-bind', root, '/runtime', '--ro-bind', browsers, '/browsers', '--chdir', '/home/session', node, '--max-old-space-size=128', '/runtime/worker.mjs');
    child = spawn('/bin/sh', ['-c', 'read -r start; exec "$@"', 'session-launch', '/usr/bin/bwrap', ...args], { detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { HOME: '/home/session', TMPDIR: '/tmp', PATH: '/usr/bin:/bin', PLAYWRIGHT_BROWSERS_PATH: '/browsers' } });
    const processChild = child;
    await new Promise<void>((resolve, reject) => { processChild.once('spawn', resolve); processChild.once('error', reject); });
    if (!processChild.pid) throw new Error('Worker did not start');
    await resources.attach(processChild.pid);
    let rejectTask: ((error: Error) => void) | undefined;
    let resolveTask: ((value: Pick<BrowserSessionResult, 'result' | 'pages' | 'attachments' | 'error'>) => void) | undefined;
    const send = (message: unknown) => { if (!stopped && processChild.stdin?.writable) processChild.stdin.write(JSON.stringify(message) + '\n'); };
    let buffered = '';
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-1000); });
    const ready = new Promise<void>((resolve, reject) => {
      rejectTask = reject;
      child!.once('error', reject);
      child!.once('exit', () => { rejectTask?.(new Error(stderr || 'Browser worker exited')); void close().catch(() => {}); });
      child!.stdin!.on('error', error => { rejectTask?.(error); void close().catch(() => {}); });
      const receive = async (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return;
        const message = raw as Record<string, unknown>;
        if (message.type === 'hello') send({ type: 'init', baseURL: options.baseURL });
        if (message.type === 'ready') { rejectTask = undefined; resolve(); }
        if (message.type === 'fatal') rejectTask?.(new Error(String(message.error)));
        if (message.type === 'result') { resolveTask?.(message.value as Parameters<NonNullable<typeof resolveTask>>[0]); resolveTask = undefined; rejectTask = undefined; }
        if (message.type !== 'fetch' || stopped) return;
        try {
          if (JSON.stringify(message).length > 100000) throw new Error('Request size limit exceeded');
          const url = new URL(String(message.url));
          if (url.origin !== new URL(options.baseURL).origin || url.username || url.password) throw new Error('Origin is outside this session');
          // Drop cookies, authorization, actor and hop-by-hop headers from arbitrary script traffic.
          const supplied = new Headers(message.headers as Record<string, string>);
          const headers = new Headers({ [BROWSER_SESSION_HEADER]: '1' });
          for (const name of ['accept', 'content-type', 'range', 'if-none-match']) if (supplied.has(name)) headers.set(name, supplied.get(name)!);
          const body = typeof message.body === 'string' ? Buffer.from(message.body, 'base64') : undefined;
          if (body && body.length > SESSION_LIMITS.scriptBytes) throw new Error('Request body limit exceeded');
          const request = new Request(url, { method: String(message.method), headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(10000) });
          await requests.run(async () => {
            const response = await sessionRequest(request, next => options.request(next, actor));
            // Streams cannot be materialized indefinitely through this bounded bridge.
            if (response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new Error('Live event streams are unavailable in scripted sessions'); }
            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = []; let size = 0;
            if (reader) for (;;) {
              const next = await reader.read(); if (next.done) break;
              size += next.value.length;
              if (size > SESSION_LIMITS.outputBytes) { await reader.cancel(); throw new Error('Response limit exceeded'); }
              chunks.push(next.value);
            }
            const out = new Headers(response.headers);
            for (const name of ['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding']) out.delete(name);
            send({ type: 'fetched', id: message.id, status: response.status, headers: Object.fromEntries(out), body: Buffer.concat(chunks).toString('base64') });
          });
        } catch (error) { send({ type: 'fetched', id: message.id, error: String((error as Error).message).slice(0, 500) }); }
      };
      child!.stdout!.setEncoding('utf8');
      child!.stdout!.on('data', (chunk: string) => {
        if (stopped) return;
        buffered += chunk;
        if (Buffer.byteLength(buffered) > SESSION_LIMITS.outputBytes) { rejectTask?.(new Error('Worker output limit exceeded')); void close(); return; }
        for (;;) {
          const end = buffered.indexOf('\n'); if (end < 0) break;
          const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
          try { void receive(JSON.parse(line)); } catch { rejectTask?.(new Error('Invalid worker output')); void close(); }
        }
      });
      processChild.stdin!.write('go\n');
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Browser worker startup timed out')), 15000); })]); }
    finally { clearTimeout(timer); }
    return { close, onClose(listener) { closedListeners.add(listener); if (stopped) listener(); },
      run(code) { return new Promise((resolve, reject) => { if (stopped) { reject(new Error('Browser worker exited')); return; } resolveTask = resolve; rejectTask = reject; send({ type: 'run', code }); }); },
    };
  } catch (error) { await close(); throw error; }
}
