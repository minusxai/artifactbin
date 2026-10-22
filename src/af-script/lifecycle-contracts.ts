/**
 * The page lifecycle behind publish.mjs and comments.mjs, as a pure model over
 * injected ports (src/af-script/publish-model.ts, comments-model.ts). Tests
 * drive it with an in-memory file system, a fake server, a fixed clock and
 * deterministic keys; the scripts use the real ones (src/af-script/ports.ts).
 *
 * The local record: a sidecar directory `.af/` beside the page file.
 *   ids.json                 { "<id>": "<path relative to the .af/ parent>" }: IDs add.mjs reserved.
 *   base/<id>.html           The page exactly as the server last accepted it (publish, save, pull).
 *                            The common ancestor for merges.
 *   base/<id><ext>           A linked backend file as last sent (ext from ids.json), so unchanged
 *                            backends are not sent again.
 *   journal/<id>.json        An in-flight save (PublishJournal), written before the request and
 *                            removed only once the outcome is known.
 *   journal/new-<page>.json  The same for a create (no ID yet), keyed by the page file name.
 *   conflict/<id>.json       An unresolved overlapping conflict (ConflictRecord).
 *   backups/<id>-<time>.html Local bytes a pull or force replaced, and remote heads a force overwrote.
 *   comments/<id>.json       What the agent has seen of the page's comments (CommentsState).
 *   context/<commentId>.html What a commenter saw (comments.mjs --context).
 *
 * publish.mjs exit codes (PUBLISH_EXIT): 0 ok; 1 refused or invalid (4xx, a
 * clean merge to review, a page the token can't edit); 2 usage or environment
 * (unknown flag, missing file, missing or refused token, AF_SERVER not a
 * Pagegi server); 3 transport with a known outcome (429/5xx after 3 tries:
 * nothing was saved, the journal is kept so a rerun replays the same request
 * with the same key); 4 overlapping conflict; 5 outcome still unknown after
 * retries (no response; the journal is kept; rerun to resolve).
 *
 * A replayed or in-flight request carries the page and backend files as they
 * were when it was journalled. Once it applies, newer edits to the page are
 * rebased onto the saved source, and a backend file that changed on disk
 * meanwhile is left as it is: the message names it and says to run again,
 * which sends the newer contents (the base records what was sent).
 */
import type { FileId } from "../af-contracts.ts";
import type { AfFetch } from "./af-contracts.ts";

export const EXIT = {
  ok: 0,
  refused: 1,
  usage: 2,
  transport: 3,
  conflict: 4,
  unknown: 5,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface FilePort {
  /** The file's text, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /**
   * Write atomically (temporary file, then rename), creating parent directories.
   * With `private` (the credential file), the file is 0600 and its directory 0700.
   */
  write(path: string, text: string, options?: { private?: boolean }): Promise<void>;
  /** Remove a file; no error when it is already gone. */
  remove(path: string): Promise<void>;
  /** Names in a directory, [] when it does not exist. */
  list(directory: string): Promise<string[]>;
}

export interface LifecyclePorts {
  fetch: AfFetch;
  fs: FilePort;
  /** Milliseconds since the epoch. */
  now(): number;
  /** A fresh unique key (requestId, Idempotency-Key). */
  random(): string;
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Stops comments --watch. */
  signal?: AbortSignal;
}

/** journal/<id>.json or journal/new-<page>.json: one write whose outcome is not known yet. */
export interface PublishJournal {
  kind: "create" | "save";
  /** The requestId (create) or Idempotency-Key (save), reused on every replay. */
  key: string;
  /** The page file, relative to the .af/ parent. */
  page: string;
  /** Null for a create. */
  id: FileId | null;
  /** If-Match of a save; null for a create. */
  baseVersion: number | null;
  /** sha256 hex of the proposed source, to see whether the file changed while the request was in flight. */
  digest: string;
  /** ISO time the journal was written. */
  time: string;
  /** The exact JSON body sent; a replay sends these bytes again. */
  body: { source: string; files?: Record<FileId, string>; requestId?: string; visibility?: import("../contracts.ts").Visibility };
  /** Backend files in the body, by ID, with their path relative to the .af/ parent. */
  backends: Record<FileId, string>;
  /** --force: the remote head this save overwrites, already backed up. */
  force?: boolean;
}

/** conflict/<id>.json: an overlapping conflict the agent has to resolve by hand. */
export interface ConflictRecord {
  /** The head the local file conflicts with. */
  version: number;
  source: string;
  /** sha256 of the local file when the conflict was found; a different file means it was resolved. */
  localDigest: string;
  time: string;
}

/** comments/<id>.json */
export interface CommentsState {
  /** The server's `since` cursor from the last poll, when it gives one. */
  cursor: string | null;
  /** Every comment the agent has been shown, at the revision it saw. */
  seen: Record<string, { revision: number; resolved: boolean }>;
}

export type PublishStatus =
  | "created"
  | "saved"
  | "unchanged"
  | "merged"
  | "conflict"
  | "pulled"
  | "forked"
  | "forced"
  | "deleted"
  | "pending"
  | "error";

/** publish.mjs --json: one object. */
export interface PublishJson {
  status: PublishStatus;
  id: FileId | null;
  version: number | null;
  url: string | null;
  /** Files written, relative to the working directory. */
  wrote: string[];
  /** Backups written, relative to the working directory. */
  backups: string[];
  /** An unresolved overlapping conflict: the same regions on every run until it is resolved. */
  conflict: { remote: string; diff: string; regions: ConflictRegion[] } | null;
  /** The human-readable message. */
  message: string;
}

/** 1-based inclusive line ranges; an empty range has end = start - 1. */
export interface ConflictRegion {
  base: [number, number];
  local: [number, number];
  remote: [number, number];
}

export type CommentEventKind = "comment" | "reply" | "edited" | "resolved" | "reopened";
