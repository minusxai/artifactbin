/**
 * THE CLI boot harness — the one way an app test drives the REAL `afbin` against the REAL route
 * handlers. Every `cli-*` test used to hand-roll the same four things: a temp workspace, a minted
 * token written into it with `saveConnection`, a `runCli(..., {interactive:false, fetch})` wrapper
 * that parses the `--json` envelope, and a `fetch` shim dispatching `/api/artifacts*` to the
 * handlers. That boilerplate appeared 21 times across 9 files and drifted between copies.
 *
 * This module owns all of it. It is deliberately a thin, honest fixture: it never stubs a route,
 * never swallows a non-zero exit unless the caller asks (`invoke`), and records every request the
 * CLI actually made so a test can assert the wire traffic it expected — including the traffic it
 * expected NOT to happen.
 *
 * Sits beside `harness.ts` (the app/database harness), `net.ts` (real sockets) and
 * `operation-http.ts`. Use with `useAppHarness()`, which owns the database.
 */
import { expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintToken } from '@/lib/tokens';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { GET as readArtifact, PUT as replaceArtifact, PATCH as patchArtifact, DELETE as deleteArtifact } from '@/app/api/artifacts/[id]/route';
import { GET as readContent } from '@/app/api/artifacts/[id]/content/route';
import { POST as postEdit } from '@/app/api/artifacts/[id]/edits/route';
import { POST as postPreflight } from '@/app/api/artifacts/preflight/route';
import { runCli } from '../../cli/src/dispatch';
import { saveConnection } from '../../cli/src/config';

/** The server every fixture connects to. Nothing binds a socket: the transport calls handlers directly. */
export const CLI_SERVER = 'http://localhost:3000';

/** One request the CLI made, as the transport saw it. */
export interface CliCall {
  method: string;
  /** Pathname only — what most assertions compare. */
  path: string;
  /** Pathname plus query, for the routes where the query IS the assertion (`?format=png&slide=2`). */
  address: string;
  /** The parsed JSON request body, or null when there was none. Proves what did NOT travel. */
  body: unknown;
}

/** `['POST /api/artifacts', ...]` — the usual shape an assertion wants. */
export const routesCalled = (calls: CliCall[]): string[] => calls.map((call) => `${call.method} ${call.path}`);
/** Same, with the query string kept. */
export const addressesCalled = (calls: CliCall[]): string[] => calls.map((call) => `${call.method} ${call.address}`);

/**
 * A route this fixture does not own. Return a `Response` to answer, or nothing to fall through to
 * the artifacts routes — that is how a test adds `/api/sessions`, `/a/<id>/raw` or `/api/secrets`
 * without re-implementing the artifacts half.
 */
export type ExtraRoute = (request: Request, url: URL) => Promise<Response | undefined | null> | Response | undefined | null;

/**
 * The artifacts API as the CLI addresses it, backed by the real handlers. An unexpected path
 * THROWS rather than 404s: a test that silently exercises a route nobody wired proves nothing.
 */
export function artifactTransport(calls: CliCall[] = [], extra?: ExtraRoute): typeof fetch {
  return async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    const raw = init?.body ? String(init.body) : '';
    let body: unknown = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    calls.push({ method: request.method, path: url.pathname, address: `${url.pathname}${url.search}`, body });
    if (extra) {
      const answered = await extra(request, url);
      if (answered) return answered;
    }
    if (url.pathname === '/api/artifacts') return createArtifact(request);
    if (url.pathname === '/api/artifacts/preflight') return postPreflight(request);
    const match = /^\/api\/artifacts\/([^/]+)(\/edits|\/content)?$/.exec(url.pathname);
    if (!match) throw new Error(`Unexpected route ${request.method} ${url.pathname}`);
    const context = { params: Promise.resolve({ id: match[1]! }) };
    if (match[2] === '/edits') return postEdit(request, context);
    if (match[2] === '/content') return readContent(request, context);
    if (request.method === 'GET') return readArtifact(request, context);
    if (request.method === 'PATCH') return patchArtifact(request, context);
    if (request.method === 'DELETE') return deleteArtifact(request, context);
    return replaceArtifact(request, context);
  };
}

/** What the CLI returned: its exit status, the parsed `--json` envelope, and anything on stderr. */
export interface CliResult {
  code: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  errors: string;
}

export interface CliWorkspace {
  /** The working directory the CLI runs in. */
  root: string;
  /** The home directory holding `.artifactbin` — the same as `root` unless `separateHome` was asked for. */
  home: string;
  /** Runs the real CLI with `--json`; never asserts on the exit status. */
  run(args: string[], fetchImpl?: typeof fetch): Promise<CliResult>;
  /** Runs the real CLI and FAILS THE TEST unless it exited 0; returns the envelope. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke(args: string[], fetchImpl?: typeof fetch): Promise<any>;
  /** Mints a token (optionally owned by a user) and saves it as this workspace's connection. */
  connect(name: string, userId?: string | null): Promise<{ id: string; token: string }>;
  /** Saves an ALREADY-minted token as this workspace's connection — for tests that claim it to a user first. */
  useToken(token: string): Promise<void>;
  /** Removes the temporary directories. Call it from a `finally`. */
  cleanup(): Promise<void>;
}

export interface CliWorkspaceOptions {
  /** Default transport for `run`/`invoke`; each call may still override it. */
  fetch?: typeof fetch;
  /** Put `.artifactbin` in a directory of its own, so a test can assert the workspace holds only the author's files. */
  separateHome?: boolean;
  /** Extra environment for the CLI process (`--secret-env` reads it). */
  env?: NodeJS.ProcessEnv;
}

/**
 * A throwaway workspace with the real CLI wired to it. The caller owns the lifetime:
 *
 *   const cli = await cliWorkspace('fork', { fetch: artifactTransport(calls) });
 *   try { await cli.connect('real-cli-fork'); … } finally { await cli.cleanup(); }
 */
export async function cliWorkspace(prefix: string, options: CliWorkspaceOptions = {}): Promise<CliWorkspace> {
  const base = await mkdtemp(join(tmpdir(), `afbin-${prefix}-`));
  const root = options.separateHome ? join(base, 'work') : base;
  const home = options.separateHome ? join(base, 'home') : base;
  if (options.separateHome) { await mkdir(root); await mkdir(home); }

  const run = async (args: string[], fetchImpl: typeof fetch | undefined = options.fetch): Promise<CliResult> => {
    const output: string[] = [];
    const errors: string[] = [];
    const code = await runCli([...args, '--json'], {
      cwd: root,
      home,
      interactive: false,
      ...(options.env ? { env: options.env } : {}),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => errors.push(value),
    });
    return { code, result: output.length ? JSON.parse(output.join('')) : null, errors: errors.join('') };
  };

  return {
    root,
    home,
    run,
    async invoke(args, fetchImpl) {
      const { code, result } = await run(args, fetchImpl);
      expect(code, JSON.stringify(result)).toBe(0);
      return result;
    },
    async connect(name, userId) {
      const token = await mintToken(name, userId ?? undefined);
      await saveConnection({ server: CLI_SERVER, token: token.token }, home);
      return { id: token.id, token: token.token };
    },
    useToken: (token: string) => saveConnection({ server: CLI_SERVER, token }, home),
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
