/**
 * THE CLI SUITE'S HARNESS — a disposable home that is also the workspace, a saved connection, and a
 * `fetch` that records every call instead of making one.
 *
 * Forty-odd files opened their own `mkdtemp` and built this by hand, and five of them had written the
 * same twelve-line `harness()` with small differences in what it recorded. The differences are options
 * here; what a test asserts on is the same `RecordedCall` everywhere.
 *
 * Runner-agnostic, like `@artifactbin/test-support` underneath it: the CLI suite runs under `node:test`.
 */
import { tempWorkspace } from '@artifactbin/test-support';
import { runCli } from '../src/dispatch';
import { saveConnection } from '../src/config';

export interface RecordedCall {
  method: string;
  /** Pathname and search, the way a route assertion wants to read it. */
  path: string;
  pathname: string;
  search: string;
  /** Parsed JSON body, or `undefined` for a body-less method or a body that is not JSON. */
  body: unknown;
  headers: Record<string, string>;
  key?: string;
}

export type Respond = (call: RecordedCall) => Response | Promise<Response>;

export interface CliHarness {
  root: string;
  home: string;
  out: string[];
  bytes: Buffer[];
  calls: RecordedCall[];
  /** `pathname + search` per call, in order — for the tests that only care where a request went. */
  paths: string[];
  /** How many requests were attempted at all, including ones that threw. */
  network(): number;
  invoke(args: string[], respond?: Respond): Promise<number>;
  /** The last JSON envelope written to stdout. */
  last<T = any>(): T;
  cleanup(): Promise<void>;
}

export interface HarnessOptions {
  server?: string;
  /** Saved before the first command; `null` starts unauthenticated. */
  token?: string | null;
  /** Appended to every `invoke`. Defaults to `['--server', server]`. */
  flags?: string[];
  /** Stamped on every response the test hands back; `null` leaves responses untouched. */
  account?: string | null;
}

const SERVER = 'https://example.com';

export async function cliHarness(prefix: string, options: HarnessOptions = {}): Promise<CliHarness> {
  const server = options.server ?? SERVER;
  const workspace = await tempWorkspace(prefix, 'shared');
  const root = workspace.root;
  const token = options.token === undefined ? 'test-token' : options.token;
  if (token !== null) await saveConnection({ server, token }, root);
  const flags = options.flags ?? ['--server', server];
  const account = options.account === undefined ? 'usr_seed' : options.account;

  const out: string[] = [];
  const bytes: Buffer[] = [];
  const calls: RecordedCall[] = [];
  const paths: string[] = [];
  let network = 0;

  const invoke = (args: string[], respond?: Respond) => runCli([...args, ...flags], {
    cwd: root,
    home: root,
    env: {},
    interactive: false,
    stdout: (s: string) => out.push(s),
    stdoutBytes: (b: Uint8Array) => bytes.push(Buffer.from(b)),
    stderr: () => {},
    auth: { open: async () => { throw new Error('a test must not open a browser'); } },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      network++;
      const request = new Request(input as never, init);
      const url = new URL(request.url);
      const body = ['GET', 'HEAD', 'DELETE'].includes(request.method) ? undefined : await request.json().catch(() => undefined);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
      const call: RecordedCall = {
        method: request.method,
        path: url.pathname + url.search,
        pathname: url.pathname,
        search: url.search,
        body,
        headers,
        ...(headers['idempotency-key'] ? { key: headers['idempotency-key'] } : {}),
      };
      calls.push(call);
      paths.push(call.path);
      if (!respond) throw new Error(`an offline operation attempted HTTP: ${request.method} ${call.path}`);
      const response = await respond(call);
      if (account !== null) response.headers.set('X-Artifactbin-Account', account);
      return response;
    },
  } as never);

  return {
    root,
    home: root,
    out,
    bytes,
    calls,
    paths,
    network: () => network,
    invoke,
    last: <T = any>() => JSON.parse(out[out.length - 1]!) as T,
    cleanup: workspace.dispose,
  };
}
