/**
 * HTTP for publish.mjs and comments.mjs: bounded retries that always resend
 * the same request (so the same idempotency key), and the `.af/` sidecar's
 * file helpers. Pure over the injected ports.
 */
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { notPagegiMessage, refusedMessage, resolveToken } from "./auth-model.ts";
import { Failure } from "./failure.ts";
import { EXIT, type LifecyclePorts } from "./lifecycle-contracts.ts";

export const ATTEMPTS = 3;
/** Waits between attempts: after the first and the second. */
export const BACKOFF_MS = [1_000, 3_000] as const;

export type Sent =
  | { kind: "response"; status: number; body: Record<string, unknown> }
  /** No response after every attempt: the request may or may not have applied. */
  | { kind: "unknown"; error: string }
  /** 429 or 5xx on every attempt. */
  | { kind: "unavailable"; status: number; body: Record<string, unknown> };

export interface Request {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export { Failure };

export interface Server {
  origin: string;
  token: string;
  /** What to print when the server answers 401: the token was refused; sign in again with auth.mjs. */
  refused: string;
  send(request: Request): Promise<Sent>;
}

/** The current server and its token (AF_TOKEN, else the credential file); exit 2 naming auth.mjs and AF_TOKEN when there is none. */
export async function connect(env: Readonly<Record<string, string | undefined>>, ports: LifecyclePorts, what: string): Promise<Server> {
  const resolved = await resolveToken(env, ports.fs, what);
  const { origin, token } = resolved;
  return {
    origin,
    token,
    refused: refusedMessage(resolved),
    async send(request) {
      const init = {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...request.headers,
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      };
      let last: Sent = { kind: "unknown", error: "no attempt" };
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt) await ports.sleep(BACKOFF_MS[attempt - 1]!);
        let response;
        try {
          response = await ports.fetch(origin + request.path, init);
        } catch (error) {
          last = { kind: "unknown", error: error instanceof Error ? error.message : String(error) };
          continue;
        }
        const parsed = await response.json().catch(() => null);
        const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        if (response.status === 429 || response.status >= 500) {
          last = { kind: "unavailable", status: response.status, body };
          continue;
        }
        // Page routes answer 403 to a token with no session behind it (the same as a
        // revoked share link), and 404 for a page that is gone, which is also what a
        // server without the API answers. One probe of the session route, which every
        // Pagegi server answers (200 or 401), tells these apart: an expired sign-in
        // gets the sign-in hint instead of "ask the owner", and a foreign server
        // names AF_SERVER instead of a page.
        if ((response.status === 403 || response.status === 404) && request.path !== SESSION_PATH) {
          const probe = await session(ports, origin, token);
          if (response.status === 403 && probe === 401) return { kind: "response", status: 401, body: { error: "The token was refused" } };
          if (response.status === 404 && probe === 404) throw new Failure(EXIT.usage, notPagegiMessage(origin, request.path));
        }
        return { kind: "response", status: response.status, body };
      }
      return last;
    },
  };
}

export const SESSION_PATH = "/api/auth/session";

/** The session route's status for this token; null when it gave no answer. */
async function session(ports: LifecyclePorts, origin: string, token: string): Promise<number | null> {
  try {
    const response = await ports.fetch(origin + SESSION_PATH, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    return response.status;
  } catch {
    return null;
  }
}

/** The server's `{ error }` message, or the status. */
export function serverMessage(sent: { status: number; body: Record<string, unknown> }): string {
  return typeof sent.body.error === "string" ? sent.body.error : `HTTP ${sent.status}`;
}

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** 20261021T101500123Z: sortable and safe in file names. */
export const stamp = (now: number) => new Date(now).toISOString().replace(/[-:.]/g, "");

/** The `.af/` sidecar beside a page (or in the working directory). */
export class Sidecar {
  readonly root: string;
  readonly ports: LifecyclePorts;
  readonly cwd: string;
  constructor(directory: string, ports: LifecyclePorts, cwd: string) {
    this.root = join(directory, ".af");
    this.ports = ports;
    this.cwd = cwd;
  }
  /** Directory the sidecar describes (paths in ids.json are relative to it). */
  get directory(): string {
    return dirname(this.root);
  }
  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }
  /** A path as the agent should see it: relative to the working directory. */
  show(path: string): string {
    return relative(this.cwd, path) || path;
  }
  read(path: string): Promise<string | null> {
    return this.ports.fs.read(path);
  }
  async readJson<T>(path: string): Promise<T | null> {
    const text = await this.ports.fs.read(path);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Failure(EXIT.refused, `${this.show(path)} is not valid JSON. It is publish.mjs's own record; restore it or remove it.`);
    }
  }
  write(path: string, text: string): Promise<void> {
    return this.ports.fs.write(path, text);
  }
  writeJson(path: string, value: unknown): Promise<void> {
    return this.ports.fs.write(path, JSON.stringify(value, null, 2) + "\n");
  }
  remove(path: string): Promise<void> {
    return this.ports.fs.remove(path);
  }
  /** ids.json: `{ id: path }`. */
  async ids(): Promise<Record<string, string>> {
    return (await this.readJson<Record<string, string>>(this.path("ids.json"))) ?? {};
  }
}
