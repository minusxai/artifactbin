/**
 * In-memory ports for the publish.mjs and comments.mjs model: a file system, a
 * fake server with the documented HTTP semantics (requestId and
 * Idempotency-Key replays, If-Match, 409 with the head, comment revisions and
 * a `since` cursor), and switches that lose a request or its response.
 * Canonical sources come from the real page model's prepareForSave.
 */
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { DEFAULT_AF_ORIGIN, KNOWN_AF_ORIGINS } from "../../../src/af-contracts.ts";
import type { AfFetch } from "../../../src/af-script/af-contracts.ts";
import { SESSION_PATH } from "../../../src/af-script/auth-contracts.ts";
import type { FilePort, LifecyclePorts } from "../../../src/af-script/lifecycle-contracts.ts";
import { prepareForSave } from "../../../src/page/page-model.ts";

export const ORIGIN = "http://server.test";

export class MemoryFs implements FilePort {
  readonly files = new Map<string, string>();
  /** Paths last written with `private` (0600 in a 0700 directory on a real disk). */
  readonly private = new Set<string>();
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, text: string, options?: { private?: boolean }) {
    this.files.set(path, text);
    if (options?.private) this.private.add(path);
    else this.private.delete(path);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async list(directory: string) {
    return [...this.files.keys()].filter((path) => dirname(path) === directory).map((path) => path.slice(directory.length + 1));
  }
  /** Paths under `prefix`, relative to it. */
  under(prefix: string): string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix + "/")).map((path) => path.slice(prefix.length + 1)).sort();
  }
}

/** What happens to one request: lost before the server sees it, or applied but its answer lost or garbled. */
export type Fault = "hang-before" | "hang-after" | "error-before" | "error-after" | "garbled-after" | { status: number };

interface Page {
  owner: string;
  editors: Set<string>;
  sources: string[];
  nextNodeId: number;
}
export interface FakeComment {
  id: string;
  nodeId: string | null;
  quote: string;
  body: string;
  parentId: string | null;
  version: number;
  author: string;
  createdAt: string;
  revision: number;
  resolved: boolean;
  sequence: number;
}
export interface Logged {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class FakeServer {
  readonly pages = new Map<string, Page>();
  readonly reserved = new Map<string, string>();
  readonly publications = new Map<string, { fingerprint: string; response: Record<string, unknown> }>();
  readonly keys = new Map<string, { fingerprint: string; status: number; response: unknown }>();
  readonly comments = new Map<string, FakeComment[]>();
  readonly log: Logged[] = [];
  /** Faults applied to the next matching requests, in order. */
  readonly faults: { match: (request: Logged) => boolean; fault: Fault }[] = [];
  /** Runs before a request is applied, e.g. to edit a local file while it is in flight. */
  beforeApply: ((request: Logged) => Promise<void> | void) | null = null;
  sequence = 0;
  ids = 0;
  /** Comment cursors are supported unless this is false. */
  cursors = true;

  token(account: string): string {
    return `token-${account}`;
  }
  reserve(account: string): string {
    const id = `Rs${String(++this.ids).padStart(4, "0")}`;
    this.reserved.set(id, account);
    return id;
  }
  head(id: string): { source: string; version: number } {
    const page = this.pages.get(id)!;
    return { source: page.sources.at(-1)!, version: page.sources.length };
  }
  /** Save directly, as another client would. */
  saveAs(account: string, id: string, edit: (source: string) => string): { source: string; version: number } {
    const page = this.pages.get(id)!;
    if (page.owner !== account && !page.editors.has(account)) throw Error("not an editor");
    return this.apply(id, edit(this.head(id).source));
  }
  fail(match: (request: Logged) => boolean, ...faults: Fault[]): void {
    for (const fault of faults) this.faults.push({ match, fault });
  }
  requests(method: string, pattern: RegExp): Logged[] {
    return this.log.filter((request) => request.method === method && pattern.test(request.path));
  }

  private apply(id: string, html: string): { source: string; version: number } {
    const page = this.pages.get(id)!;
    const version = page.sources.length + 1;
    const reserved = new Set<string>();
    for (const source of page.sources) for (const match of source.matchAll(/data-af-id="([^"]+)"/g)) reserved.add(match[1]!);
    const prepared = prepareForSave(html, {
      id,
      version,
      origin: ORIGIN,
      knownOrigins: KNOWN_AF_ORIGINS,
      previousNextNodeId: page.nextNodeId,
      reserved,
    });
    page.sources.push(prepared.source);
    page.nextNodeId = Number(prepared.meta.nextNodeId) || page.nextNodeId;
    return { source: prepared.source, version };
  }

  readonly fetch: AfFetch = async (url, init) => {
    const parsed = new URL(url);
    const request: Logged = {
      method: init.method,
      path: parsed.pathname + parsed.search,
      headers: init.headers,
      body: init.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>),
    };
    this.log.push(request);
    const index = this.faults.findIndex((entry) => entry.match(request));
    const fault = index >= 0 ? this.faults.splice(index, 1)[0]!.fault : null;
    if (fault === "hang-before") return new Promise(() => {});
    if (fault === "error-before") throw TypeError("fetch failed");
    if (fault && typeof fault === "object") return respond(fault.status, { error: "Unavailable" });
    if (this.beforeApply) await this.beforeApply(request);
    const [status, body] = this.handle(request);
    if (fault === "hang-after") return new Promise(() => {});
    if (fault === "error-after") throw TypeError("other side closed");
    if (fault === "garbled-after") return respond(status, {});
    return respond(status, body);
  };

  private handle(request: Logged): [number, unknown] {
    const account = /^Bearer token-(.+)$/.exec(request.headers.Authorization ?? "")?.[1];
    if (!account) return [401, { error: "Sign in required" }];
    const { method, path } = request;
    const body = request.body ?? {};
    // Every Pagegi server answers the session route (200 or 401); only a foreign server is 404 here.
    if (method === "GET" && path === SESSION_PATH) return [200, { username: account }];
    if (method === "POST" && path === "/api/publish") {
      const key = `${account}:${body.requestId}`;
      const print = fingerprint([body.source, body.files ?? {}]);
      const earlier = this.publications.get(key);
      if (earlier) return earlier.fingerprint === print ? [200, earlier.response] : [409, { error: "This requestId was already used for a different publish" }];
      const meta = /"id":\s*"([A-Za-z0-9]{6})"/.exec(String(body.source))?.[1];
      // A named ID must be the caller's unpublished reservation; anything else is refused, never a fresh ID.
      if (meta && (this.reserved.get(meta) !== account || this.pages.has(meta)))
        return [422, { error: `The meta block names ID ${meta}, which is not an ID you reserved and have not published` }];
      const id = meta ?? `Pg${String(++this.ids).padStart(4, "0")}`;
      this.pages.set(id, { owner: account, editors: new Set(), sources: [], nextNodeId: 0 });
      const saved = this.apply(id, String(body.source));
      const response = { id, version: 1, url: `${ORIGIN}/a/${id}`, path: id, source: saved.source };
      this.publications.set(key, { fingerprint: print, response });
      return [201, response];
    }
    const file = /^\/api\/files\/([A-Za-z0-9]{6})(\/.*)?$/.exec(path.split("?")[0]!);
    if (!file) return [404, { error: "Not found" }];
    const [, id, rest = ""] = file as unknown as [string, string, string];
    const page = this.pages.get(id!);
    const reader = page && (page.owner === account || page.editors.has(account) || account.startsWith("viewer"));
    if (!page || !reader) return [404, { error: "File not found" }];
    const editor = page.owner === account || page.editors.has(account);
    if (method === "GET" && rest === "/source") return [200, this.head(id!)];
    if (method === "PUT" && rest === "/source") {
      if (!editor) return [403, { error: "Only owners and editors can change the page" }];
      const key = request.headers["Idempotency-Key"];
      const print = fingerprint(body);
      const stored = key ? this.keys.get(`${account}:${id}:${key}`) : undefined;
      if (stored) return stored.fingerprint === print ? [stored.status, stored.response] : [422, { error: "Idempotency-Key reused with another body" }];
      const head = this.head(id!);
      if (Number(request.headers["If-Match"]) !== head.version)
        return [409, { error: "Someone else saved first.", version: head.version, source: head.source }];
      const saved = this.apply(id!, String(body.source));
      if (key) this.keys.set(`${account}:${id}:${key}`, { fingerprint: print, status: 200, response: saved });
      return [200, saved];
    }
    if (method === "DELETE" && rest === "") {
      if (page.owner !== account) return [404, { error: "File not found" }];
      this.pages.delete(id!);
      return [200, { deleted: true }];
    }
    const list = this.comments.get(id!) ?? [];
    this.comments.set(id!, list);
    const record = ({ sequence: _, ...comment }: FakeComment) => comment;
    if (method === "GET" && rest === "/comments") {
      const since = new URL(path, ORIGIN).searchParams.get("since");
      const changed = list.filter((comment) => !since || comment.sequence > Number(since));
      return [200, { comments: changed.map(record), head: page.sources.length, ...(this.cursors ? { cursor: String(this.sequence) } : {}) }];
    }
    if (method === "POST" && rest === "/comments") {
      const key = request.headers["Idempotency-Key"];
      const stored = key ? this.keys.get(`${account}:${id}:${key}`) : undefined;
      if (stored) return [stored.status, stored.response];
      const input = body.comment as Record<string, unknown>;
      const comment: FakeComment = {
        id: `c${list.length + 1}`,
        nodeId: (input.nodeId as string | null) ?? null,
        quote: String(input.quote ?? ""),
        body: String(input.body),
        parentId: (input.parentId as string | null) ?? null,
        version: page.sources.length,
        author: account,
        createdAt: new Date(0).toISOString(),
        revision: 1,
        resolved: false,
        sequence: ++this.sequence,
      };
      list.push(comment);
      if (key) this.keys.set(`${account}:${id}:${key}`, { fingerprint: "", status: 201, response: record(comment) });
      return [201, record(comment)];
    }
    const one = /^\/comments\/(.+)$/.exec(rest);
    if (method === "PUT" && one) {
      const comment = list.find((entry) => entry.id === one[1]);
      if (!comment) return [404, { error: "Comment not found" }];
      if (Number(request.headers["If-Match"]) !== comment.revision) return [409, { error: "The comment changed", revision: comment.revision }];
      if (typeof body.body === "string") comment.body = body.body;
      if (typeof body.resolved === "boolean") comment.resolved = body.resolved;
      comment.revision++;
      comment.sequence = ++this.sequence;
      return [200, record(comment)];
    }
    const context = /^\/context\/(.+)$/.exec(rest);
    if (method === "GET" && context) {
      const comment = list.find((entry) => entry.id === context[1]);
      if (!comment) return [404, { error: "Comment not found" }];
      return [200, { comment: record(comment), source: page.sources[comment.version - 1], state: { todos: [] } }];
    }
    return [404, { error: "Not found" }];
  }

  /** Comment as another account would. */
  comment(account: string, id: string, input: { nodeId: string | null; body: string; parentId?: string }): FakeComment {
    const [, created] = this.handle({
      method: "POST",
      path: `/api/files/${id}/comments`,
      headers: { Authorization: `Bearer token-${account}` },
      body: { comment: { quote: "", parentId: null, ...input } },
    });
    return created as FakeComment;
  }
}

function respond(status: number, body: unknown) {
  return { status, json: async () => body };
}

/** Ports over one fake server and file system, with a fixed clock and counted keys. */
export function fakePorts(server: FakeServer, fs: MemoryFs, extra: Partial<LifecyclePorts> = {}) {
  let keys = 0;
  let clock = Date.UTC(2026, 9, 21, 10, 0, 0);
  const sleeps: number[] = [];
  const ports: LifecyclePorts = {
    fetch: server.fetch,
    fs,
    now: () => clock,
    random: () => `key-${++keys}`,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    ...extra,
  };
  return { ports, sleeps, advance: (ms: number) => (clock += ms) };
}

/** A page source in the skill's style, with an editable body. */
export function page(body: string, meta = '{ "name": "Plan" }'): string {
  return `<!DOCTYPE html>
<html>
<head>
  <script src="${DEFAULT_AF_ORIGIN}/af/v1/core.js"></script>
  <script type="application/json" data-af="meta">
  ${meta}
  </script>
  <title>Plan</title>
</head>
<body>
${body}
</body>
</html>
`;
}
