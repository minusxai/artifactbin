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
 * Sits beside `harness.ts` (the app/database harness) and `operation-http.ts`; real sockets come
 * from `@artifactbin/test-support/net`. Use with `useAppHarness()`, which owns the database.
 */
import { expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintAccountToken } from './harness';
import { runCli } from '../../cli/src/dispatch';
import { saveConnection, saveDefaultServer } from '../../cli/src/config';

/** The server every fixture connects to. Nothing binds a socket: the transport calls handlers directly. */
const CLI_SERVER = 'http://localhost:3000';

/** What the CLI returned: its exit status, the parsed `--json` envelope, and anything on stderr. */
interface CliResult {
  code: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  errors: string;
}

interface CliWorkspace {
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
  connect(name: string, userId?: string | null): Promise<{ id: string; token: string; userId: string | null }>;
  /** Saves an ALREADY-minted token as this workspace's connection — for tests that claim it to a user first. */
  useToken(token: string): Promise<void>;
  /** Removes the temporary directories. Call it from a `finally`. */
  cleanup(): Promise<void>;
}

interface CliWorkspaceOptions {
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
 *   const cli = await cliWorkspace('fork', { fetch: transport });
 *   try { await cli.connect('real-cli-fork'); … } finally { await cli.cleanup(); }
 */
export async function cliWorkspace(prefix: string, options: CliWorkspaceOptions = {}): Promise<CliWorkspace> {
  const base = await mkdtemp(join(tmpdir(), `afbin-${prefix}-`));
  const root = options.separateHome ? join(base, 'work') : base;
  const home = options.separateHome ? join(base, 'home') : base;
  if (options.separateHome) { await mkdir(root); await mkdir(home); }

  await saveDefaultServer(CLI_SERVER, home, options.env);

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
      // The app harness's one account-token mint: an email account unless the caller names one (or null).
      const token = await mintAccountToken(name, userId);
      await saveConnection({ server: CLI_SERVER, token: token.token }, home);
      return { id: token.id, token: token.token, userId: token.userId };
    },
    useToken: (token: string) => saveConnection({ server: CLI_SERVER, token }, home),
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
