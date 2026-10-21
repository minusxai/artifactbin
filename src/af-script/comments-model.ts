/**
 * comments.mjs: read, answer and watch a page's comments, as a pure model over
 * injected ports (contract: ./lifecycle-contracts.ts).
 *
 * New comments and replies carry an Idempotency-Key that is journalled in
 * `.af/journal/` until the outcome is known, so rerunning the same command
 * after an unknown outcome never posts twice. Edits and resolves send the
 * revision the agent last saw as If-Match. `.af/comments/<id>.json` records
 * what the agent has been shown, which is also how --watch resumes.
 */
import { dirname, resolve } from "node:path";
import { FILE_ID_PATTERN, type FileId } from "../af-contracts.ts";
import type { CommentsAction } from "./af-contracts.ts";
import { EXIT, type CommentEventKind, type CommentsState, type ExitCode, type LifecyclePorts } from "./lifecycle-contracts.ts";
import { readMeta } from "./page-merge.ts";
import { stateAddress } from "./state-url.ts";
import type { AfJson } from "../af-contracts.ts";
import { Failure, Sidecar, connect, digest, serverMessage, type Request, type Sent, type Server } from "./transport.ts";

/** The comment fields the server returns (CommentRecord in src/server/af-api-contracts.ts). */
export interface Comment {
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
}

export interface CommentsContext {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  ports: LifecyclePorts;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** Seconds between --watch polls, and the longest wait after repeated errors. */
export const WATCH_INTERVAL_MS = 2_000;
export const WATCH_MAX_BACKOFF_MS = 30_000;

function isComment(value: unknown): value is Comment {
  const comment = value as Comment;
  return !!comment && typeof comment === "object" && typeof comment.id === "string" && typeof comment.revision === "number";
}

class Comments {
  readonly id: FileId;
  readonly sidecar: Sidecar;
  readonly server: Server;
  readonly context: CommentsContext;
  readonly json: boolean;
  constructor(id: FileId, sidecar: Sidecar, server: Server, context: CommentsContext, json: boolean) {
    this.id = id;
    this.sidecar = sidecar;
    this.server = server;
    this.context = context;
    this.json = json;
  }
  get statePath(): string {
    return this.sidecar.path("comments", `${this.id}.json`);
  }
  async state(): Promise<CommentsState> {
    return (await this.sidecar.readJson<CommentsState>(this.statePath)) ?? { cursor: null, seen: {} };
  }
  async saveState(state: CommentsState): Promise<void> {
    await this.sidecar.writeJson(this.statePath, state);
  }
  async see(comments: readonly Comment[], cursor?: string | null): Promise<CommentsState> {
    const state = await this.state();
    for (const comment of comments) state.seen[comment.id] = { revision: comment.revision, resolved: comment.resolved };
    if (cursor !== undefined) state.cursor = cursor;
    await this.saveState(state);
    return state;
  }

  /** A response, or a Failure with the right exit code. */
  async request(request: Request): Promise<Extract<Sent, { kind: "response" }>> {
    const sent = await this.server.send(request);
    if (sent.kind === "unknown") throw new Failure(EXIT.unknown, `No answer from ${this.server.origin} after 3 tries: ${sent.error}`);
    if (sent.kind === "unavailable") throw new Failure(EXIT.transport, `The server answered ${sent.status} (${serverMessage(sent)}) 3 times.`);
    if (sent.status === 401)
      throw new Failure(EXIT.usage, this.server.refused);
    return sent;
  }
  async list(since?: string | null): Promise<{ comments: Comment[]; cursor: string | null; head: number | null; status: number }> {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const sent = await this.request({ method: "GET", path: `/api/files/${this.id}/comments${query}` });
    if (sent.status !== 200) {
      if (since && (sent.status === 400 || sent.status === 410)) return { comments: [], cursor: null, head: null, status: sent.status };
      throw new Failure(EXIT.refused, `Could not read the comments on ${this.id} (${sent.status}): ${serverMessage(sent)}`);
    }
    const comments = Array.isArray(sent.body.comments) ? sent.body.comments.filter(isComment) : [];
    const cursor = sent.body.cursor === undefined || sent.body.cursor === null ? null : String(sent.body.cursor);
    return { comments, cursor, head: typeof sent.body.head === "number" ? sent.body.head : null, status: 200 };
  }
  out(text: string): void {
    this.context.stdout(text);
  }
}

const where = (comment: Comment) => (comment.nodeId ? `on ${comment.nodeId}` : "on the page");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function threads(comments: readonly Comment[]): (Comment & { replies: Comment[] })[] {
  const roots = comments.filter((comment) => !comment.parentId || !comments.some((other) => other.id === comment.parentId));
  return roots.map((root) => ({ ...root, replies: comments.filter((comment) => comment.parentId === root.id) }));
}

function printThreads(page: Comments, comments: readonly Comment[], head: number | null): void {
  const all = threads(comments);
  if (page.json) {
    page.out(JSON.stringify({ id: page.id, head, threads: all }, null, 2) + "\n");
    return;
  }
  if (!all.length) page.out(`${page.id} has no comments.\n`);
  for (const thread of all) {
    const quote = thread.quote ? ` "${oneLine(thread.quote)}"` : "";
    page.out(
      `${thread.id} ${where(thread)}${quote} by ${thread.author}, version ${thread.version}, revision ${thread.revision}${thread.resolved ? ", resolved" : ""}\n` +
        `  ${oneLine(thread.body)}\n`,
    );
    for (const reply of thread.replies)
      page.out(`  reply ${reply.id} by ${reply.author}, revision ${reply.revision}${reply.resolved ? ", resolved" : ""}: ${oneLine(reply.body)}\n`);
  }
}

async function find(page: Comments, commentId: string): Promise<Comment> {
  const { comments } = await page.list();
  await page.see(comments);
  return comments.find((comment) => comment.id === commentId) ?? fail(EXIT.refused, `${page.id} has no comment ${commentId}.`);
}

function fail(code: ExitCode, message: string): never {
  throw new Failure(code, message);
}

/** POST a comment or reply with an Idempotency-Key that survives until the outcome is known. */
async function post(page: Comments, input: { nodeId: string | null; quote: string; body: string; parentId: string | null }): Promise<number> {
  const journal = page.sidecar.path("journal", `comment-${page.id}-${digest(JSON.stringify(input)).slice(0, 16)}.json`);
  const pending = await page.sidecar.readJson<{ key: string; time: string }>(journal);
  const key = pending?.key ?? page.context.ports.random();
  if (!pending) await page.sidecar.writeJson(journal, { key, time: new Date(page.context.ports.now()).toISOString(), request: input });
  const sent = await page.server.send({
    method: "POST",
    path: `/api/files/${page.id}/comments`,
    headers: { "Idempotency-Key": key },
    body: { comment: input },
  });
  const again = `Run the same command again: it resends the same request, which the server applies at most once.`;
  if (sent.kind === "unknown") fail(EXIT.unknown, `No answer from ${page.server.origin} after 3 tries (${sent.error}), so it is not known whether the comment was posted. ${again}`);
  if (sent.kind === "unavailable") fail(EXIT.transport, `The server answered ${sent.status} (${serverMessage(sent)}) 3 times; nothing was posted. ${again}`);
  await page.sidecar.remove(journal);
  if (sent.status === 401) fail(EXIT.usage, page.server.refused);
  if (sent.status < 200 || sent.status > 299 || !isComment(sent.body)) fail(EXIT.refused, `The server refused the comment (${sent.status}): ${serverMessage(sent)}`);
  const comment = sent.body as Comment;
  await page.see([comment]);
  if (page.json) page.out(JSON.stringify({ comment }, null, 2) + "\n");
  else page.out(`Posted ${comment.parentId ? `reply ${comment.id} to ${comment.parentId}` : `comment ${comment.id} ${where(comment)}`}.${pending ? " (Resolved the earlier attempt.)" : ""}\n`);
  return EXIT.ok;
}

/** PUT a change with the revision the agent last saw as If-Match. */
async function change(page: Comments, commentId: string, patch: { body?: string; resolved?: boolean }): Promise<number> {
  const state = await page.state();
  const revision = state.seen[commentId]?.revision ?? (await find(page, commentId)).revision;
  const sent = await page.request({
    method: "PUT",
    path: `/api/files/${page.id}/comments/${encodeURIComponent(commentId)}`,
    headers: { "If-Match": String(revision) },
    body: patch,
  });
  if (sent.status === 409 || sent.status === 412) {
    const current = await find(page, commentId);
    fail(
      EXIT.conflict,
      `Comment ${commentId} changed since you read it (you saw revision ${revision}; it is now revision ${current.revision}${current.resolved ? ", resolved" : ""}): ${oneLine(current.body)}\n` +
        `The change may be your own earlier attempt, if a previous run got no answer. Review it, then run the command again if it is still needed.`,
    );
  }
  if (sent.status < 200 || sent.status > 299 || !isComment(sent.body)) fail(EXIT.refused, `The server refused the change (${sent.status}): ${serverMessage(sent)}`);
  const comment = sent.body as Comment;
  await page.see([comment]);
  if (page.json) page.out(JSON.stringify({ comment }, null, 2) + "\n");
  else page.out(`${patch.resolved === undefined ? "Edited" : patch.resolved ? "Resolved" : "Reopened"} ${comment.id}; it is now revision ${comment.revision}.\n`);
  return EXIT.ok;
}

async function showContext(page: Comments, commentId: string): Promise<number> {
  const sent = await page.request({ method: "GET", path: `/api/files/${page.id}/context/${encodeURIComponent(commentId)}` });
  if (sent.status !== 200 || typeof sent.body.source !== "string" || !isComment(sent.body.comment))
    fail(EXIT.refused, `Could not read what comment ${commentId} was made on (${sent.status}): ${serverMessage(sent)}`);
  const comment = sent.body.comment as Comment;
  const sourcePath = page.sidecar.path("context", `${commentId}.html`);
  await page.sidecar.write(sourcePath, sent.body.source as string);
  const state = sent.body.state && typeof sent.body.state === "object" ? sent.body.state : null;
  const statePath = state ? page.sidecar.path("context", `${commentId}.state.json`) : null;
  if (statePath) await page.sidecar.writeJson(statePath, state);
  await page.see([comment]);
  // Opens the page with the commenter's state as the viewer's own local state.
  const url = state ? stateAddress(`${page.server.origin}/a/${page.id}`, state as AfJson) : null;
  // `url` as the HTTP API's context response names it.
  const files = { source: page.sidecar.show(sourcePath), state: statePath && page.sidecar.show(statePath), url };
  if (page.json) page.out(JSON.stringify({ comment, ...files }, null, 2) + "\n");
  else
    page.out(
      `${comment.id} ${where(comment)} by ${comment.author} on version ${comment.version}: ${oneLine(comment.body)}\n` +
        `The page as they saw it: ${files.source}\n` +
        (files.state ? `Its state then: ${files.state}\nOpen it with that state: ${url}\n` : "The page had no saved state.\n"),
    );
  return EXIT.ok;
}

function classify(comment: Comment, seen: CommentsState["seen"][string] | undefined): CommentEventKind | null {
  if (!seen) return comment.parentId ? "reply" : "comment";
  if (comment.revision <= seen.revision) return null;
  if (comment.resolved !== seen.resolved) return comment.resolved ? "resolved" : "reopened";
  return "edited";
}

/** Poll for changes until the signal aborts. Each change prints once, even across restarts. */
async function watch(page: Comments): Promise<number> {
  const { ports } = page.context;
  let failures = 0;
  if (!page.json) page.context.stderr(`Watching comments on ${page.id}. Stop with Ctrl-C; a restart resumes where this stopped.\n`);
  while (!ports.signal?.aborted) {
    let wait = WATCH_INTERVAL_MS;
    try {
      const state = await page.state();
      const result = await page.list(state.cursor);
      if (result.status !== 200) {
        // The cursor expired: read everything again; `seen` keeps it from repeating.
        await page.see([], null);
        continue;
      }
      for (const comment of result.comments) {
        const event = classify(comment, state.seen[comment.id]);
        if (!event) continue;
        if (page.json) page.out(JSON.stringify({ event, comment }) + "\n");
        else
          page.out(
            `${event} ${comment.id} ${where(comment)} by ${comment.author}${comment.parentId ? ` (reply to ${comment.parentId})` : ""}: ${oneLine(comment.body)}\n`,
          );
        state.seen[comment.id] = { revision: comment.revision, resolved: comment.resolved };
      }
      state.cursor = result.cursor;
      await page.saveState(state);
      if (failures) page.context.stderr(`Connected again.\n`);
      failures = 0;
    } catch (error) {
      if (error instanceof Failure && (error.code === EXIT.usage || error.code === EXIT.refused)) throw error;
      failures++;
      wait = Math.min(WATCH_MAX_BACKOFF_MS, WATCH_INTERVAL_MS * 2 ** failures);
      page.context.stderr(`${error instanceof Error ? error.message : String(error)} Retrying in ${Math.round(wait / 1000)}s.\n`);
    }
    await ports.sleep(wait, ports.signal);
  }
  return EXIT.ok;
}

/** Run comments.mjs; returns the exit code. */
export async function runComments(target: string, action: CommentsAction, json: boolean, context: CommentsContext): Promise<number> {
  try {
    const server = await connect(context.env, context.ports, "read or answer comments");
    const path = resolve(context.cwd, target);
    const source = FILE_ID_PATTERN.test(target) ? null : await context.ports.fs.read(path);
    let id: string;
    let directory: string;
    if (source !== null) {
      const meta = readMeta(source);
      if (typeof meta?.id !== "string" || !FILE_ID_PATTERN.test(meta.id))
        fail(EXIT.usage, `${target} has no page ID in its meta block. Publish it first with publish.mjs.`);
      id = meta.id;
      directory = dirname(path);
    } else if (FILE_ID_PATTERN.test(target)) {
      id = target;
      directory = context.cwd;
    } else fail(EXIT.usage, `Cannot read ${target}: give a page file or a six-character page ID.`);
    const page = new Comments(id, new Sidecar(directory, context.ports, context.cwd), server, context, json);
    switch (action.kind) {
      case "list": {
        const result = await page.list();
        await page.see(result.comments);
        printThreads(page, result.comments, result.head);
        return EXIT.ok;
      }
      case "context":
        return await showContext(page, action.commentId);
      case "comment":
        return await post(page, { nodeId: action.nodeId, quote: action.quote, body: action.body, parentId: null });
      case "reply": {
        const parent = await find(page, action.commentId);
        return await post(page, { nodeId: parent.nodeId, quote: "", body: action.body, parentId: parent.parentId ?? parent.id });
      }
      case "edit":
        return await change(page, action.commentId, { body: action.body });
      case "resolve":
        return await change(page, action.commentId, { resolved: action.resolved });
      case "watch":
        return await watch(page);
    }
  } catch (error) {
    if (error instanceof Failure) {
      context.stderr(error.message + "\n");
      return error.code;
    }
    throw error;
  }
}
