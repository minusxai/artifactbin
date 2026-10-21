/**
 * publish.mjs: the whole lifecycle of a page file against the server, as a
 * pure model over injected ports (contract: ./lifecycle-contracts.ts).
 *
 * Every write is journalled before it is sent and replayed with the same key
 * until its outcome is known, so a create never runs twice and a save never
 * conflicts with itself. A 409 is merged three ways from `.af/base/<id>.html`;
 * the merged file is never saved without the agent rerunning publish.mjs.
 */
import { basename, dirname, extname, resolve } from "node:path";
import { FILE_ID_PATTERN, type FileId } from "../af-contracts.ts";
import * as pageModel from "../page/page-model.ts";
import type { PublishMode } from "./af-contracts.ts";
import {
  EXIT,
  type ConflictRecord,
  type ConflictRegion,
  type ExitCode,
  type LifecyclePorts,
  type PublishJournal,
  type PublishJson,
  type PublishStatus,
} from "./lifecycle-contracts.ts";
import { unifiedDiff } from "./merge.ts";
import { adoptPlatformMeta, mergePages, readMeta, stripIdentity } from "./page-merge.ts";
import { Failure, Sidecar, connect, digest, serverMessage, stamp, type Sent, type Server } from "./transport.ts";

export interface PublishContext {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  ports: LifecyclePorts;
}

export interface PublishOutcome {
  code: ExitCode;
  json: PublishJson;
}

type Draft = Omit<PublishJson, "status" | "message">;

class Run {
  readonly file: string;
  readonly name: string;
  readonly sidecar: Sidecar;
  readonly server: Server;
  readonly ports: LifecyclePorts;
  readonly result: Draft = { id: null, version: null, url: null, wrote: [], backups: [], conflict: null };
  constructor(file: string, sidecar: Sidecar, server: Server, ports: LifecyclePorts) {
    this.file = file;
    this.name = basename(file);
    this.sidecar = sidecar;
    this.server = server;
    this.ports = ports;
  }

  get shown(): string {
    return this.sidecar.show(this.file);
  }
  /** The page's canonical address when the server did not say one. */
  url(id: FileId): string {
    return `${this.server.origin}/a/${id}`;
  }
  basePath(id: FileId): string {
    return this.sidecar.path("base", `${id}.html`);
  }
  journalPath(id: FileId | null): string {
    return this.sidecar.path("journal", id ? `${id}.json` : `new-${this.name}.json`);
  }
  conflictPath(id: FileId): string {
    return this.sidecar.path("conflict", `${id}.json`);
  }
  /** page.html → page.remote.html / page.conflict.diff beside it. */
  beside(suffix: string): string {
    const stem = this.name.endsWith(".html") ? this.name.slice(0, -5) : this.name;
    return resolve(dirname(this.file), `${stem}.${suffix}`);
  }
  async write(path: string, text: string): Promise<void> {
    await this.sidecar.write(path, text);
    const shown = this.sidecar.show(path);
    if (!this.result.wrote.includes(shown)) this.result.wrote.push(shown);
  }
  /** The page matches the server again: drop the conflict record and the files it pointed at. */
  async resolved(id: FileId): Promise<void> {
    if (!(await this.sidecar.read(this.conflictPath(id)))) return;
    for (const path of [this.conflictPath(id), this.beside("remote.html"), this.beside("conflict.diff")]) await this.sidecar.remove(path);
  }
  async backup(id: FileId, text: string, suffix = ""): Promise<string> {
    const path = this.sidecar.path("backups", `${id}-${stamp(this.ports.now())}${suffix}.html`);
    await this.sidecar.write(path, text);
    const shown = this.sidecar.show(path);
    this.result.backups.push(shown);
    return shown;
  }
  done(code: ExitCode, status: PublishStatus, message: string): PublishOutcome {
    return { code, json: { status, ...this.result, message } };
  }

  /** Linked backend files with a local file (ids.json) whose contents differ from what was last sent. */
  async backends(source: string): Promise<{ files: Record<FileId, string>; paths: Record<FileId, string> }> {
    const ids = await this.sidecar.ids();
    const files: Record<FileId, string> = {};
    const paths: Record<FileId, string> = {};
    for (const link of pageModel.parsePage(source).backends) {
      const id = link.id;
      if (!id || !Object.hasOwn(ids, id)) continue;
      const path = ids[id]!;
      const content = await this.sidecar.read(resolve(this.sidecar.directory, path));
      if (content === null)
        throw new Failure(
          EXIT.refused,
          `${this.shown} links backend ${id} (data-af-name="${link.name}"), which .af/ids.json says is ${path}, but that file is missing. Restore it, or link a published backend.`,
        );
      if ((await this.sidecar.read(this.backendBase(id, path))) === content) continue;
      files[id] = content;
      paths[id] = path;
    }
    return { files, paths };
  }
  backendBase(id: FileId, path: string): string {
    return this.sidecar.path("base", `${id}${extname(path) || ".txt"}`);
  }

  /** Send a journalled write; settle() drops the journal once the outcome is known and recorded locally. */
  send(journal: PublishJournal): Promise<Sent> {
    return this.server.send(
      journal.kind === "create"
        ? { method: "POST", path: "/api/publish", body: journal.body }
        : {
            method: "PUT",
            path: `/api/files/${journal.id}/source`,
            headers: { "If-Match": String(journal.baseVersion), "Idempotency-Key": journal.key },
            body: journal.body,
          },
    );
  }

  /** Write a fresh journal, then send it. */
  async start(journal: Omit<PublishJournal, "time" | "page">): Promise<PublishOutcome> {
    const full: PublishJournal = { ...journal, page: this.name, time: new Date(this.ports.now()).toISOString() };
    await this.sidecar.writeJson(this.journalPath(full.kind === "create" ? null : full.id), full);
    return this.settle(full, await this.send(full), false);
  }

  /** Act on the outcome of a journalled write. */
  async settle(journal: PublishJournal, sent: Sent, replayed: boolean): Promise<PublishOutcome> {
    // A definite answer ends the journal once it is acted on. A 2xx means the server
    // applied it, so anything that stops the write-back (a full disk, an answer missing
    // the saved page) keeps the journal, and the rerun replays the same request, which
    // the server applies at most once. Any other answer means nothing was applied.
    let decided = false;
    try {
      const outcome = await this.decide(journal, sent, replayed);
      decided = true;
      return outcome;
    } catch (error) {
      decided = sent.kind === "response" && !(sent.status >= 200 && sent.status < 300);
      throw error;
    } finally {
      if (decided && sent.kind === "response") await this.sidecar.remove(this.journalPath(journal.kind === "create" ? null : journal.id));
    }
  }

  async decide(journal: PublishJournal, sent: Sent, replayed: boolean): Promise<PublishOutcome> {
    const what = journal.kind === "create" ? "publish" : "save";
    if (sent.kind === "unknown")
      return this.done(
        EXIT.unknown,
        "pending",
        `No answer from ${this.server.origin} after 3 tries (${sent.error}), so it is not known whether the ${what} applied. ` +
          `Run publish.mjs ${this.shown} again: it resends the same request, which the server applies at most once.`,
      );
    if (sent.kind === "unavailable")
      return this.done(
        EXIT.transport,
        "error",
        `The server answered ${sent.status} (${serverMessage(sent)}) 3 times, so nothing was saved. ` +
          `The request is kept in .af/journal/; run publish.mjs ${this.shown} again later and it is replayed with the same key.`,
      );
    const { status, body } = sent;
    if (status >= 200 && status < 300) return this.applied(journal, body, replayed);
    if (status === 401)
      throw new Failure(EXIT.usage, this.server.refused);
    if (journal.kind === "save" && status === 409) {
      // --force read the head just before; someone saved again since. force() starts over.
      if (journal.force) return this.done(EXIT.conflict, "conflict", `${journal.id} changed again while --force was overwriting it.`);
      return this.conflicted(journal, sent);
    }
    if (journal.kind === "save" && (status === 403 || status === 404))
      return this.done(
        EXIT.refused,
        "error",
        `You can't save page ${journal.id} with this token (${status}: ${serverMessage(sent)}). ` +
          `To publish ${this.shown} as a new page of your own, run publish.mjs ${this.shown} --new.`,
      );
    let message = `The server refused the ${what} (${status}): ${serverMessage(sent)}`;
    if (/is not published/.test(message))
      message += `. Give the backend file an ID with add.mjs (run it in the page's folder, so .af/ids.json records its path), or link a published backend.`;
    if (journal.kind === "create" && /meta block names ID/.test(message))
      message += `. To publish ${this.shown} as a new page of your own, run publish.mjs ${this.shown} --new.`;
    return this.done(EXIT.refused, "error", message);
  }

  /** Backend files sent by `journal` whose file on disk has changed since: the server runs what was sent. */
  async staleBackends(journal: PublishJournal): Promise<string[]> {
    const stale: string[] = [];
    for (const [backend, path] of Object.entries(journal.backends))
      if ((await this.sidecar.read(resolve(this.sidecar.directory, path))) !== journal.body.files?.[backend]) stale.push(this.sidecar.show(resolve(this.sidecar.directory, path)));
    return stale;
  }

  /** 2xx: write the canonical source back, unless the file changed while the request was in flight. */
  async applied(journal: PublishJournal, body: Record<string, unknown>, replayed: boolean): Promise<PublishOutcome> {
    const source = typeof body.source === "string" ? body.source : null;
    const version = typeof body.version === "number" ? body.version : null;
    const id = journal.kind === "create" ? (typeof body.id === "string" ? body.id : null) : journal.id;
    if (source === null || version === null || id === null || !FILE_ID_PATTERN.test(id))
      throw new Failure(
        EXIT.refused,
        `The server's answer has no page source, version and ID. Run publish.mjs ${this.shown} again: it resends the same request, which the server applies at most once.`,
      );
    this.result.id = id;
    this.result.version = version;
    this.result.url = typeof body.url === "string" ? body.url : this.url(id);
    await this.sidecar.write(this.basePath(id), source);
    for (const [backend, path] of Object.entries(journal.backends))
      await this.sidecar.write(this.backendBase(backend, path), journal.body.files![backend]!);
    const current = await this.sidecar.read(this.file);
    const status: PublishStatus = journal.force ? "forced" : journal.kind === "create" ? (journal.id ? "forked" : "created") : "saved";
    const verb = journal.kind === "create" ? `Published ${this.shown} as ${id}, version ${version}` : `Saved ${id}, version ${version}`;
    const prefix = replayed ? `Resolved the earlier ${journal.kind === "create" ? "publish" : "save"}: ` : "";
    // A backend file edited since the request was journalled stays as it is: the base records
    // what the server runs, so the next run sends the newer contents.
    const stale = await this.staleBackends(journal);
    const backends = stale.length
      ? ` ${stale.join(", ")} changed while it was saving; the server runs the version that was sent, and your newer edits are kept. Run publish.mjs ${this.shown} again to send them.`
      : "";
    if (current === null || digest(current) === journal.digest) {
      await this.write(this.file, source);
      await this.resolved(id);
      return this.done(EXIT.ok, status, `${prefix}${verb}. ${this.shown} now holds the saved source.${backends}\n${this.result.url}`);
    }
    // Edited while the request was in flight: rebase those edits onto the saved source.
    const merged = mergePages(journal.body.source, current, source);
    if (merged.clean) {
      await this.write(this.file, merged.text);
      await this.resolved(id);
      return this.done(
        EXIT.ok,
        status,
        `${prefix}${verb}. ${this.shown} changed while it was saving; your newer edits are kept on top of the saved source. Run publish.mjs ${this.shown} again to save them.${backends}\n${this.result.url}`,
      );
    }
    return this.overlap(id, version, journal.body.source, current, source, `${prefix}${verb}, but ${this.shown} changed while it was saving and the edits overlap.${backends}`);
  }

  /** 409: someone else saved first. Merge their head with the local file. */
  async conflicted(journal: PublishJournal, sent: Extract<Sent, { kind: "response" }>): Promise<PublishOutcome> {
    const id = journal.id!;
    let head: { source: string; version: number };
    if (typeof sent.body.source === "string" && typeof sent.body.version === "number")
      head = { source: sent.body.source, version: sent.body.version };
    else head = await this.head(id);
    this.result.id = id;
    this.result.version = head.version;
    this.result.url = this.url(id);
    const current = (await this.sidecar.read(this.file)) ?? journal.body.source;
    const record = await this.sidecar.readJson<ConflictRecord>(this.conflictPath(id));
    const base = record?.source ?? (await this.sidecar.read(this.basePath(id)));
    const intro = `Someone else saved ${id} first (now version ${head.version}).`;
    if (base === null) return this.overlap(id, head.version, null, current, head.source, `${intro} There is no record of the version you started from, so the two can't be merged.`);
    const merged = mergePages(base, current, head.source);
    if (!merged.clean) return this.overlap(id, head.version, base, current, head.source, intro);
    await this.write(this.file, merged.text);
    await this.sidecar.write(this.basePath(id), head.source);
    await this.resolved(id);
    if (merged.text === head.source)
      return this.done(EXIT.ok, "unchanged", `${intro} It already has all of your changes; ${this.shown} now matches it.`);
    return this.done(
      EXIT.refused,
      "merged",
      `${intro} Their changes and yours touch different lines, so ${this.shown} now holds both. Nothing was saved: review the file, then run publish.mjs ${this.shown} again.`,
    );
  }

  /** Overlapping edits: leave the page alone, write the remote copy and a diff, and record the conflict. */
  async overlap(id: FileId, version: number, base: string | null, local: string, remote: string, intro: string): Promise<PublishOutcome> {
    const remotePath = this.beside("remote.html");
    const diffPath = this.beside("conflict.diff");
    const merged = base === null ? null : mergePages(base, local, remote);
    // The platform's meta members (version, nextNodeId) follow the remote side, so they never show as a change.
    const ancestor = base === null ? null : adoptPlatformMeta(base, remote);
    const mine = adoptPlatformMeta(local, remote);
    const diff =
      ancestor === null
        ? unifiedDiff(remote, mine, "remote", "local")
        : unifiedDiff(ancestor, mine, "base", "local") + unifiedDiff(ancestor, remote, "base", "remote");
    await this.write(remotePath, remote);
    await this.write(diffPath, diff);
    await this.sidecar.writeJson(this.conflictPath(id), {
      version,
      source: remote,
      localDigest: digest(local),
      time: new Date(this.ports.now()).toISOString(),
    } satisfies ConflictRecord);
    const regions = merged?.conflicts ?? [];
    this.result.conflict = { remote: this.sidecar.show(remotePath), diff: this.sidecar.show(diffPath), regions };
    return this.done(
      EXIT.conflict,
      "conflict",
      `${intro} ${this.shown} is unchanged${describeRegions(regions)}. ` +
        `The latest version is in ${this.result.conflict.remote} and both sides' changes are in ${this.result.conflict.diff}. ` +
        `Edit ${this.shown} to combine them, then run publish.mjs ${this.shown} again (or --pull to take theirs, or --force to keep yours).`,
    );
  }

  async head(id: FileId): Promise<{ source: string; version: number }> {
    const sent = await this.server.send({ method: "GET", path: `/api/files/${id}/source` });
    if (sent.kind === "unknown") throw new Failure(EXIT.unknown, `No answer from ${this.server.origin} after 3 tries: ${sent.error}`);
    if (sent.kind === "unavailable") throw new Failure(EXIT.transport, `The server answered ${sent.status} (${serverMessage(sent)}) 3 times.`);
    if (sent.status === 401)
      throw new Failure(EXIT.usage, this.server.refused);
    if (sent.status !== 200 || typeof sent.body.source !== "string" || typeof sent.body.version !== "number")
      throw new Failure(EXIT.refused, `Could not read page ${id} (${sent.status}): ${serverMessage(sent)}`);
    return { source: sent.body.source, version: sent.body.version };
  }

  async pendingJournal(id: FileId | null): Promise<PublishJournal | null> {
    return (
      (await this.sidecar.readJson<PublishJournal>(this.journalPath(null))) ??
      (id ? await this.sidecar.readJson<PublishJournal>(this.journalPath(id)) : null)
    );
  }
}

/** Run publish.mjs. Failures become exit codes with a message; nothing throws. */
export async function publishPage(file: string, mode: PublishMode, context: PublishContext): Promise<PublishOutcome> {
  const fail = (code: ExitCode, message: string): PublishOutcome => ({
    code,
    json: { status: "error", id: null, version: null, url: null, wrote: [], backups: [], conflict: null, message },
  });
  const path = resolve(context.cwd, file);
  const what = { publish: "publish or save pages", new: "publish pages", force: "save pages", pull: "read pages", delete: "delete pages" }[mode];
  let run: Run;
  try {
    const server = await connect(context.env, context.ports, what);
    run = new Run(path, new Sidecar(dirname(path), context.ports, context.cwd), server, context.ports);
  } catch (error) {
    if (error instanceof Failure) return fail(error.code, error.message);
    throw error;
  }
  try {
    return await lifecycle(run, mode);
  } catch (error) {
    if (error instanceof Failure) return { code: error.code, json: { status: "error", ...run.result, message: error.message } };
    throw error;
  }
}

async function lifecycle(run: Run, mode: PublishMode): Promise<PublishOutcome> {
  const source = await run.sidecar.read(run.file);
  if (source === null) throw new Failure(EXIT.usage, `Cannot read ${run.shown}: no such file.`);
  const meta = readMeta(source);
  const id = typeof meta?.id === "string" && FILE_ID_PATTERN.test(meta.id) ? meta.id : null;
  run.result.id = id;

  // A write whose outcome is unknown comes first: replay it with the same key.
  const pending = await run.pendingJournal(id);
  if (pending) {
    if (mode === "pull" || mode === "delete")
      throw new Failure(
        EXIT.refused,
        `A ${pending.kind === "create" ? "publish" : "save"} of ${run.shown} from ${pending.time} has no known outcome yet. Run publish.mjs ${run.shown} first to resolve it.`,
      );
    const outcome = await run.settle(pending, await run.send(pending), true);
    if (outcome.code === EXIT.ok && mode !== "publish")
      outcome.json.message += ` Run the same command again to continue with --${mode}.`;
    return outcome;
  }

  if (mode === "new") return create(run, source, true);
  if (!id) {
    if (mode === "publish") return create(run, source, false);
    throw new Failure(EXIT.usage, `${run.shown} has no page ID in its meta block, so there is nothing to ${mode}. Run publish.mjs ${run.shown} to publish it.`);
  }
  if (mode === "pull") return pull(run, id, source);
  if (mode === "delete") return remove(run, id);
  if (mode === "force") return force(run, id, source);

  const base = await run.sidecar.read(run.basePath(id));
  // An ID add.mjs reserved for this page, never published: publish it under that ID.
  if (base === null && Object.hasOwn(await run.sidecar.ids(), id)) return create(run, source, false);
  return save(run, id, source, base, meta);
}

async function create(run: Run, source: string, fork: boolean): Promise<PublishOutcome> {
  const proposal = fork ? stripIdentity(source) : source;
  const { files, paths } = await run.backends(proposal);
  const requestId = run.ports.random();
  return run.start({
    kind: "create",
    key: requestId,
    id: fork ? (run.result.id ?? null) : null,
    baseVersion: null,
    digest: digest(source),
    body: { source: proposal, ...(Object.keys(files).length ? { files } : {}), requestId },
    backends: paths,
  });
}

async function save(
  run: Run,
  id: FileId,
  source: string,
  base: string | null,
  meta: Record<string, unknown> | null,
): Promise<PublishOutcome> {
  const record = await run.sidecar.readJson<ConflictRecord>(run.conflictPath(id));
  if (record && digest(source) === record.localDigest) {
    run.result.version = record.version;
    run.result.url = run.url(id);
    // The same overlapping regions as when the conflict was found: the base, the file and the head are unchanged.
    const regions = base === null ? [] : mergePages(base, source, record.source).conflicts;
    run.result.conflict = { remote: run.sidecar.show(run.beside("remote.html")), diff: run.sidecar.show(run.beside("conflict.diff")), regions };
    return run.done(
      EXIT.conflict,
      "conflict",
      `${run.shown} still conflicts with version ${record.version}: it hasn't changed since the conflict was found${describeRegions(regions)}. ` +
        `Combine it with ${run.result.conflict.remote} (see ${run.result.conflict.diff}), then run publish.mjs ${run.shown} again, or use --pull or --force.`,
    );
  }
  // A changed file after a conflict is its resolution: it builds on the head that conflicted.
  const ancestor = record ? record.source : base;
  const version = record ? record.version : typeof meta?.version === "number" ? meta.version : null;
  if (version === null)
    throw new Failure(EXIT.refused, `${run.shown} has an ID but no version in its meta block. Run publish.mjs ${run.shown} --pull to get the current page.`);
  const { files, paths } = await run.backends(source);
  run.result.version = version;
  run.result.url = run.url(id);
  if (ancestor !== null && source === ancestor && !Object.keys(files).length) {
    if (record) {
      await run.sidecar.write(run.basePath(id), record.source);
      await run.resolved(id);
    }
    return run.done(EXIT.ok, "unchanged", `${run.shown} is unchanged since version ${version}; nothing to save.`);
  }
  // The record stays until the save succeeds, so a failed save is still read as a resolution of that head.
  if (record) await run.sidecar.write(run.basePath(id), record.source);
  return run.start({
    kind: "save",
    key: run.ports.random(),
    id,
    baseVersion: version,
    digest: digest(source),
    body: { source, ...(Object.keys(files).length ? { files } : {}) },
    backends: paths,
  });
}

async function pull(run: Run, id: FileId, source: string): Promise<PublishOutcome> {
  const head = await run.head(id);
  const base = await run.sidecar.read(run.basePath(id));
  run.result.version = head.version;
  run.result.url = run.url(id);
  let kept = "";
  if (source !== head.source && source !== base) kept = ` Your local copy is backed up at ${await run.backup(id, source)}.`;
  await run.write(run.file, head.source);
  await run.sidecar.write(run.basePath(id), head.source);
  await run.resolved(id);
  return run.done(EXIT.ok, "pulled", `${run.shown} now holds version ${head.version} of ${id}.${kept}`);
}

async function force(run: Run, id: FileId, source: string): Promise<PublishOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await run.head(id);
    const base = (await run.sidecar.read(run.basePath(id))) ?? null;
    if (head.source === source) {
      await run.sidecar.write(run.basePath(id), head.source);
      run.result.version = head.version;
      run.result.url = run.url(id);
      return run.done(EXIT.ok, "unchanged", `${run.shown} already matches version ${head.version}; nothing to overwrite.`);
    }
    const saved = await run.backup(id, head.source, "-remote");
    const { files, paths } = await run.backends(source);
    const outcome = await run.start({
      kind: "save",
      key: run.ports.random(),
      id,
      baseVersion: head.version,
      digest: digest(source),
      body: { source, ...(Object.keys(files).length ? { files } : {}) },
      backends: paths,
      force: true,
    });
    // Someone saved again between the read and the save: start over from the new head.
    if (outcome.json.status === "conflict" && attempt < 2) continue;
    if (outcome.code === EXIT.ok) {
      const lost = base === null ? "" : summary(adoptPlatformMeta(base, head.source), head.source);
      outcome.json.message = `Overwrote version ${head.version}${lost ? ` (${lost} since the version you started from)` : ""}; that version is backed up at ${saved}. ${outcome.json.message}`;
    }
    return outcome;
  }
  throw new Failure(EXIT.conflict, `${id} kept changing while --force tried to overwrite it. Try again.`);
}

/** "; the overlapping edits are at line 13, lines 20-22 of it", or nothing when the regions are unknown. */
function describeRegions(regions: readonly ConflictRegion[]): string {
  const lines = regions.map(({ local: [start, end] }) => (end > start ? `lines ${start}-${end}` : `line ${start}`)).join(", ");
  return lines ? `; the overlapping edits are at ${lines} of it` : "";
}

/** "their changes: 3 lines added, 1 removed": how far `after` is from `before`. */
function summary(before: string, after: string): string {
  const diff = unifiedDiff(before, after, "a", "b");
  const added = (diff.match(/^\+(?!\+\+ )/gm) ?? []).length;
  const removed = (diff.match(/^-(?!-- )/gm) ?? []).length;
  return added || removed ? `their changes: ${added} line${added === 1 ? "" : "s"} added, ${removed} removed` : "";
}

async function remove(run: Run, id: FileId): Promise<PublishOutcome> {
  const sent = await run.server.send({ method: "DELETE", path: `/api/files/${id}` });
  if (sent.kind === "unknown")
    return run.done(EXIT.unknown, "pending", `No answer from ${run.server.origin} after 3 tries (${sent.error}). Run the same command again; deleting twice is safe.`);
  if (sent.kind === "unavailable") return run.done(EXIT.transport, "error", `The server answered ${sent.status} (${serverMessage(sent)}) 3 times; nothing was deleted.`);
  if (sent.status === 401)
    throw new Failure(EXIT.usage, run.server.refused);
  if (sent.status === 404)
    return run.done(EXIT.refused, "error", `Page ${id} was not found, or you are not its owner (only the owner can delete a page).`);
  if (sent.status < 200 || sent.status > 299) return run.done(EXIT.refused, "error", `The server refused the delete (${sent.status}): ${serverMessage(sent)}`);
  for (const path of [run.basePath(id), run.conflictPath(id), run.journalPath(id), run.sidecar.path("comments", `${id}.json`)])
    await run.sidecar.remove(path);
  const ids = await run.sidecar.ids();
  if (Object.hasOwn(ids, id)) {
    delete ids[id];
    await run.sidecar.writeJson(run.sidecar.path("ids.json"), ids);
  }
  return run.done(
    EXIT.ok,
    "deleted",
    `Deleted page ${id} and its records in .af/. ${run.shown} still names it; to publish the file again as a new page, run publish.mjs ${run.shown} --new.`,
  );
}

/** Human-readable output: the message, then any written files. */
export function describe(outcome: PublishOutcome): { stdout: string; stderr: string } {
  const { json } = outcome;
  const text = json.message + "\n";
  return outcome.code === EXIT.ok ? { stdout: text, stderr: "" } : { stdout: "", stderr: text };
}
