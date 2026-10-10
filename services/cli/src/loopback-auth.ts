/**
 * NO-CLICK BROWSER SIGN-IN (RFC 8252 loopback redirect + PKCE S256).
 *
 * `afbin auth` on the machine that runs the browser listens on 127.0.0.1 (else [::1]), opens the
 * server's loopback sign-in page, and a browser already signed in there is redirected straight back
 * to this listener with a one-minute, single-use code. The code is redeemed with the PKCE verifier
 * at the SELECTED server only, and the connection is saved exactly as device approval saves it.
 *
 * Returns null whenever this path does not apply, and the caller runs the device flow instead:
 * an SSH session, a server that does not advertise the loopback endpoints, no loopback address to
 * bind, a browser that cannot be opened, or no callback within the bounded wait.
 */
import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {CliError} from './commands';
import {configDir,normalizeServer,saveConnection,type Connection} from './config';
import {transportFailure} from './http';

/** An unattended agent waits this long for a browser before falling back (and, in the device flow, before giving up). */
export const AGENT_APPROVAL_WAIT_MS = 45_000;
/** A person at a terminal may need to log in by email first. */
const INTERACTIVE_SIGN_IN_WAIT_MS = 5 * 60_000;
const CALLBACK_PATH = '/callback';

export interface LoopbackOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  interactive: boolean;
  /** Verified other addresses of the selected server: where its sign-in page may live. */
  aliases?: readonly string[];
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  open: (url: string) => Promise<void>;
  notify: (message: string) => void;
}

/** A browser opened from an SSH session opens on the remote machine's desktop, never the person's. */
function remoteSession(env: NodeJS.ProcessEnv): boolean {
  return !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

type Callback = {code: string; response: ServerResponse} | {error: string; response: ServerResponse};

export async function loopbackAuthenticate(origin: string, options: LoopbackOptions): Promise<Connection | null> {
  const server = normalizeServer(origin);
  const env = options.env ?? process.env;
  if (remoteSession(env)) return null;
  const request = options.fetch ?? fetch;
  const endpoint = await signInEndpoint(server, options.aliases ?? [], request);
  if (!endpoint) return null;
  const listener = await listen();
  if (!listener) return null;
  const {http, redirectUri} = listener;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  let settle!: (value: Callback) => void;
  const callback = new Promise<Callback>(resolve => { settle = resolve; });
  let settled = false;
  http.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', redirectUri);
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) { respond(res, 404, 'Not found', 'Nothing here.'); return; }
    // A callback for any other request (an old tab, another site) is ignored; this command keeps waiting.
    if (settled || url.searchParams.get('state') !== state) { respond(res, 400, 'Sign-in not recognised', 'This sign-in does not belong to the waiting afbin command. Run afbin auth again if it is still waiting.'); return; }
    const code = url.searchParams.get('code');
    settled = true;
    settle(code ? {code, response: res} : {error: url.searchParams.get('error') ?? 'invalid_response', response: res});
  });
  try {
    const authorize = new URL(endpoint);
    authorize.search = new URLSearchParams({redirect_uri: redirectUri, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state}).toString();
    options.notify(`Signing in to ${server} in your browser; the command continues by itself once the browser is signed in.`);
    try { await options.open(authorize.href); }
    catch { return null; }
    const clock = options.now ?? Date.now;
    const deadline = clock() + (options.interactive ? INTERACTIVE_SIGN_IN_WAIT_MS : AGENT_APPROVAL_WAIT_MS);
    let outcome: Callback | undefined;
    void callback.then(value => { outcome = value; });
    while (!outcome && clock() < deadline) await Promise.race([callback, (options.sleep ?? sleep)(Math.min(1000, Math.max(0, deadline - clock())))]);
    if (!outcome) return null;
    if ('error' in outcome) {
      respond(outcome.response, 400, 'Sign-in failed', 'Return to your terminal and run afbin auth again.');
      throw new CliError('auth_failed', 'Browser sign-in failed.', 'Run afbin auth again.');
    }
    try {
      const connection = await redeem(server, outcome.code, verifier, redirectUri, request, clock);
      await saveConnection(connection, options.home ?? homedir(), {ARTIFACTBIN_HOME: configDir(options.home ?? homedir(), options.env)});
      respond(outcome.response, 200, 'Signed in', 'Signed in — you can close this tab', 'Return to your terminal; the command is continuing.');
      return connection;
    } catch (error) {
      respond(outcome.response, 400, 'Sign-in failed', 'Return to your terminal and run afbin auth again.');
      throw error;
    }
  } finally {
    http.close();
    http.closeAllConnections();
  }
}

/** The server's advertised loopback page, accepted only on the selected server or its verified addresses. */
async function signInEndpoint(server: string, aliases: readonly string[], request: typeof fetch): Promise<string | null> {
  try {
    const response = await request(`${server}/.well-known/oauth-authorization-server`, {redirect: 'error', signal: AbortSignal.timeout(5000)});
    if (!response.ok) return null;
    const metadata = await response.json() as Record<string, unknown> | null;
    const advertised = new URL(String(metadata?.cli_loopback_authorization_endpoint));
    const origins = [server, ...aliases.map(alias => { try { return normalizeServer(alias); } catch { return ''; } })];
    if (!origins.includes(advertised.origin) || advertised.pathname !== '/oauth/loopback' || advertised.search || advertised.hash) return null;
    return advertised.href;
  } catch { return null; }
}

/** An ephemeral port on the IPv4 loopback, else the IPv6 one. */
async function listen(): Promise<{http: Server; redirectUri: string} | null> {
  for (const [host, literal] of [['127.0.0.1', '127.0.0.1'], ['::1', '[::1]']] as const) {
    const http = createServer();
    const port = await new Promise<number | null>(resolve => {
      http.once('error', () => resolve(null));
      http.listen(0, host, () => { const address = http.address(); resolve(typeof address === 'object' && address ? address.port : null); });
    });
    if (port) return {http, redirectUri: `http://${literal}:${port}${CALLBACK_PATH}`};
    http.close();
  }
  return null;
}

/** Redeem the code at the SELECTED server only; the credential never travels anywhere else. */
async function redeem(server: string, code: string, verifier: string, redirectUri: string, request: typeof fetch, clock: () => number): Promise<Connection> {
  const response = await request(`${server}/oauth/loopback/token`, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, code_verifier: verifier, redirect_uri: redirectUri})}).catch(error => { throw transportFailure(server, error); });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new CliError('auth_failed', `Browser sign-in could not be completed (HTTP ${response.status}).`, 'Run afbin auth again.');
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.client_id !== 'string'
    || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new CliError('invalid_response', 'Authentication server returned invalid credentials.');
  return {server, token: data.access_token, refreshToken: data.refresh_token, clientId: data.client_id, expiresAt: clock() + data.expires_in * 1000};
}

function respond(response: ServerResponse, status: number, title: string, heading: string, detail = ''): void {
  if (response.headersSent) return;
  const escape = (text: string) => text.replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[ch]!);
  response.writeHead(status, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer', Connection: 'close'});
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222;background:#fff}@media(prefers-color-scheme:dark){body{color:#eee;background:#111}}</style><h1>${escape(heading)}</h1>${detail ? `<p>${escape(detail)}</p>` : ''}`);
}
