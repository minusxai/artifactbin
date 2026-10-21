/**
 * auth.mjs and the token every other script sends (contract: ./auth-contracts.ts).
 * Pure over the injected ports: fetch, a file system and a clock.
 */
import { join } from "node:path";
import { AF_SERVER_ENV, AF_TOKEN_ENV, DEFAULT_AF_ORIGIN } from "../af-contracts.ts";
import {
  AF_HOME_ENV,
  CREDENTIALS_FILE,
  SESSION_PATH,
  type AuthAction,
  type AuthContext,
  type AuthJson,
  type AuthServerStatus,
  type CredentialFile,
  type CredentialFilePort,
  type ResolvedToken,
  type SavedCredential,
} from "./auth-contracts.ts";
import { EXIT, type ExitCode } from "./lifecycle-contracts.ts";
import { Failure } from "./failure.ts";

type Env = AuthContext["env"];

const SIGN_IN = "node scripts/auth.mjs --email <address>";

export function currentServer(env: Env): string {
  const configured = env[AF_SERVER_ENV] || DEFAULT_AF_ORIGIN;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Failure(EXIT.usage, `${AF_SERVER_ENV}=${configured} is not a URL. Set it to a server's address, such as ${DEFAULT_AF_ORIGIN}.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Failure(EXIT.usage, `${AF_SERVER_ENV}=${configured} is not an http or https address.`);
  return url.origin;
}

export function credentialsPath(env: Env): string {
  const directory = env[AF_HOME_ENV];
  if (directory) return join(directory, CREDENTIALS_FILE);
  const home = env.HOME || env.USERPROFILE;
  if (!home) throw new Failure(EXIT.usage, `HOME is not set, so there is nowhere to keep credentials. Set ${AF_HOME_ENV} to a folder for them.`);
  return join(home, ".af", CREDENTIALS_FILE);
}

function isCredential(value: unknown): value is SavedCredential {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SavedCredential).token === "string" &&
    (value as SavedCredential).token !== "" &&
    typeof (value as SavedCredential).email === "string"
  );
}

/** The saved credentials; entries that aren't credentials are left out. */
async function readCredentials(fs: Pick<CredentialFilePort, "read">, path: string): Promise<CredentialFile> {
  const text = await fs.read(path);
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Failure(EXIT.usage, `${path} is not valid JSON. Remove it and sign in again with ${SIGN_IN}.`);
  return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => isCredential(entry))) as CredentialFile;
}

async function writeCredentials(fs: CredentialFilePort, path: string, file: CredentialFile): Promise<void> {
  await fs.write(path, JSON.stringify(file, null, 2) + "\n", { private: true });
}

export async function resolveToken(env: Env, fs: Pick<CredentialFilePort, "read">, what: string): Promise<ResolvedToken> {
  const origin = currentServer(env);
  const token = env[AF_TOKEN_ENV];
  if (token) return { origin, token, source: "AF_TOKEN", email: null };
  // Without HOME or AF_HOME there is no file to read: not signed in.
  const path = env[AF_HOME_ENV] || env.HOME || env.USERPROFILE ? credentialsPath(env) : null;
  const saved = path === null ? undefined : (await readCredentials(fs, path))[origin];
  if (saved) return { origin, token: saved.token, source: "credentials", email: saved.email || null };
  throw new Failure(
    EXIT.usage,
    `Not signed in to ${origin}. To ${what}, run ${SIGN_IN} to sign in, ` +
      `or set ${AF_TOKEN_ENV} to an account token (and ${AF_SERVER_ENV} for a server other than ${DEFAULT_AF_ORIGIN}).`,
  );
}

/** The command that signs in to `origin` again. */
function signInCommand(origin: string, email: string | null): string {
  const prefix = origin === DEFAULT_AF_ORIGIN ? "" : `${AF_SERVER_ENV}=${origin} `;
  return `${prefix}node scripts/auth.mjs --email ${email || "<address>"}`;
}

export function refusedMessage(token: Pick<ResolvedToken, "origin" | "source" | "email">): string {
  if (token.source === "AF_TOKEN")
    return `${token.origin} refused ${AF_TOKEN_ENV} (401). Set ${AF_TOKEN_ENV} to a new token, or unset it and run node scripts/auth.mjs --email <address> to sign in again.`;
  return `${token.origin} refused the saved token (401). Run node scripts/auth.mjs --email ${token.email || "<address>"} to sign in again.`;
}

/** `origin` answered 404 to `path`, a route every Pagegi server has: it is not a Pagegi server. */
export function notPagegiMessage(origin: string, path: string): string {
  return `${origin} does not look like a Pagegi server: ${path} answered 404. Set ${AF_SERVER_ENV} to your Pagegi server's address (the default is ${DEFAULT_AF_ORIGIN}).`;
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** One request, no retries: sign-in requests are rate limited, and status needs one answer per server. */
async function call(context: AuthContext, origin: string, method: string, path: string, init: { token?: string; body?: unknown } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await context.ports.fetch(origin + path, {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    throw new Failure(EXIT.transport, `Could not reach ${origin}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = await response.json().catch(() => null);
  const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { status: response.status, body };
}

const said = (answer: Answer) => (typeof answer.body.error === "string" ? answer.body.error : `HTTP ${answer.status}`);

/** A failure for a non-2xx answer: 429 and 4xx are refusals, 5xx a server error. */
function refusal(answer: Answer, what: string): Failure {
  const code: ExitCode = answer.status >= 500 ? EXIT.transport : EXIT.refused;
  return new Failure(code, `${what} (${answer.status}: ${said(answer)}).`);
}

class Output {
  readonly context: AuthContext;
  readonly json: boolean;
  readonly notes: string[] = [];
  constructor(context: AuthContext, json: boolean) {
    this.context = context;
    this.json = json;
  }
  note(text: string) {
    this.notes.push(text);
  }
  /** Prints any notes on stderr, then the JSON object, or the message on stdout (stderr for an error). */
  done(code: number, result: AuthJson): number {
    for (const note of this.notes) this.context.stderr(note + "\n");
    if (this.json) this.context.stdout(JSON.stringify(result, null, 2) + "\n");
    else {
      if (result.status === "error") this.context.stderr(result.message + "\n");
      else this.context.stdout(result.message + "\n");
    }
    return code;
  }
}

export async function runAuth(action: AuthAction, json: boolean, context: AuthContext): Promise<number> {
  const output = new Output(context, json);
  let server = context.env[AF_SERVER_ENV] || DEFAULT_AF_ORIGIN;
  let file = "";
  try {
    server = currentServer(context.env);
    file = credentialsPath(context.env);
    return await perform(action, { server, file, context, output });
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    const email = "email" in action ? action.email : null;
    return output.done(error.code, { status: "error", server, email, file, message: error.message });
  }
}

interface Run {
  server: string;
  file: string;
  context: AuthContext;
  output: Output;
}

async function perform(action: AuthAction, run: Run): Promise<number> {
  switch (action.kind) {
    case "status":
      return status(run);
    case "request":
      return request(run, action.email);
    case "verify":
      return save(run, action.email, "/api/auth/email/verify", { email: action.email, code: action.code });
    case "test-token":
      run.output.note(`Note: --test-token only works on development servers that enable it; use --email and --code everywhere else.`);
      return save(run, action.email, "/api/auth/test-token", { email: action.email });
    case "logout":
      return logout(run);
  }
}

function overridden(run: Run) {
  if (run.context.env[AF_TOKEN_ENV])
    run.output.note(`Note: ${AF_TOKEN_ENV} is set, so the scripts send it instead of the saved token until you unset it.`);
}

async function request(run: Run, email: string): Promise<number> {
  const path = "/api/auth/email/request";
  const answer = await call(run.context, run.server, "POST", path, { body: { email } });
  if (answer.status === 404) throw new Failure(EXIT.usage, notPagegiMessage(run.server, path));
  if (answer.status !== 200) throw refusal(answer, `${run.server} did not send a code to ${email}`);
  return run.output.done(EXIT.ok, {
    status: "sent",
    server: run.server,
    email,
    file: run.file,
    message: `Sent a sign-in code to ${email}. Run node scripts/auth.mjs --email ${email} --code <code> with the code from the email.`,
  });
}

async function save(run: Run, email: string, path: string, body: Record<string, string>): Promise<number> {
  const answer = await call(run.context, run.server, "POST", path, { body });
  if (answer.status === 404) {
    // Only the test-token route is ever 404 on a Pagegi server; the session route tells that apart from no server at all.
    const session = path.endsWith("/test-token") ? await call(run.context, run.server, "GET", SESSION_PATH).catch(() => null) : null;
    if (!session || session.status === 404) throw new Failure(EXIT.usage, notPagegiMessage(run.server, path));
    throw new Failure(EXIT.refused, `${run.server} does not issue test tokens (404). Sign in with node scripts/auth.mjs --email ${email} instead.`);
  }
  if (answer.status === 401) throw new Failure(EXIT.refused, `${run.server} refused the code (${said(answer)}). Check it, or ask for a new one with node scripts/auth.mjs --email ${email}.`);
  if (answer.status !== 200) throw refusal(answer, `${run.server} did not sign you in`);
  const token = answer.body.token;
  if (typeof token !== "string" || !token) throw new Failure(EXIT.transport, `${run.server} answered without a token.`);
  const account = typeof answer.body.username === "string" && answer.body.username ? answer.body.username : email;
  const saved = await readCredentials(run.context.ports.fs, run.file);
  saved[run.server] = { token, email: account, savedAt: new Date(run.context.ports.now()).toISOString() };
  await writeCredentials(run.context.ports.fs, run.file, saved);
  overridden(run);
  return run.output.done(EXIT.ok, {
    status: "signed-in",
    server: run.server,
    email: account,
    file: run.file,
    message: `Signed in to ${run.server} as ${account}. The token is saved in ${run.file}.`,
  });
}

async function logout(run: Run): Promise<number> {
  const saved = await readCredentials(run.context.ports.fs, run.file);
  const entry = saved[run.server];
  if (entry) {
    delete saved[run.server];
    await writeCredentials(run.context.ports.fs, run.file, saved);
  }
  overridden(run);
  return run.output.done(EXIT.ok, {
    status: "signed-out",
    server: run.server,
    email: entry?.email ?? null,
    file: run.file,
    message: entry ? `Signed out of ${run.server}: removed its token from ${run.file}.` : `No saved token for ${run.server}; nothing to remove.`,
  });
}

/** Whether `token` still works on `origin`: one GET /api/auth/session. */
async function check(
  run: Run,
  origin: string,
  token: string,
  email: string | null,
): Promise<Pick<AuthServerStatus, "state" | "email" | "detail">> {
  let answer: Answer;
  try {
    answer = await call(run.context, origin, "GET", SESSION_PATH, { token });
  } catch (error) {
    const cause = error instanceof Failure ? error.message.replace(`Could not reach ${origin}: `, "") : String(error);
    return { state: "unknown", email, detail: `could not reach it (${cause})` };
  }
  if (answer.status === 200) return { state: "signed-in", email: typeof answer.body.username === "string" ? answer.body.username : email, detail: null };
  if (answer.status === 401) return { state: "signed-out", email, detail: "the server refused the token (401)" };
  if (answer.status === 404) return { state: "unknown", email, detail: `it ${notPagegiMessage(origin, SESSION_PATH).slice(origin.length + 1).replace(/\.$/, "")}` };
  return { state: "unknown", email, detail: `could not check the token (${answer.status}: ${said(answer)})` };
}

function describe(entry: AuthServerStatus): string {
  const name = entry.current ? `${entry.server} (current)` : entry.server;
  const from = entry.source === "AF_TOKEN" ? `, using ${AF_TOKEN_ENV}` : "";
  if (entry.state === "signed-in") return `${name}: signed in${entry.email ? ` as ${entry.email}` : ""}${from}.`;
  if (entry.source === null) return `${name}: not signed in. Run ${signInCommand(entry.server, null)}.`;
  const again =
    entry.source === "AF_TOKEN" ? `Set ${AF_TOKEN_ENV} to a new token, or unset it and run ${signInCommand(entry.server, null)}.` : `Run ${signInCommand(entry.server, entry.email)} to sign in again.`;
  if (entry.state === "signed-out") return `${name}: signed out${entry.email ? ` (${entry.email})` : ""}${from}: ${entry.detail}. ${again}`;
  return `${name}: ${entry.email ?? "unknown account"}${from}, but ${entry.detail}.`;
}

async function status(run: Run): Promise<number> {
  const saved = await readCredentials(run.context.ports.fs, run.file);
  const envToken = run.context.env[AF_TOKEN_ENV];
  const origins = [run.server, ...Object.keys(saved).filter((origin) => origin !== run.server).sort()];
  const servers = await Promise.all(
    origins.map(async (origin): Promise<AuthServerStatus> => {
      const current = origin === run.server;
      const entry = saved[origin];
      const source = current && envToken ? "AF_TOKEN" : entry ? "credentials" : null;
      const base = { server: origin, current, source } as const;
      if (source === null) return { ...base, email: null, state: "signed-out", detail: "no saved token" };
      const token = source === "AF_TOKEN" ? envToken! : entry!.token;
      const email = source === "AF_TOKEN" ? null : entry!.email || null;
      return { ...base, ...(await check(run, origin, token, email)) };
    }),
  );
  const current = servers[0]!;
  return run.output.done(current.state === "signed-in" ? EXIT.ok : EXIT.refused, {
    status: "status",
    server: run.server,
    email: current.email,
    file: run.file,
    servers,
    message: servers.map(describe).join("\n"),
  });
}
