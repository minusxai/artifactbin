import type { RuntimeStatus, SaveResult } from "./browser/platform-status-contracts.ts";
import type {
  Account,
  SessionGrant,
  EmailChallenge,
} from "./identity-data-contracts.ts";
export type {
  Account,
  SessionGrant,
  EmailChallenge,
  EmailDeliveryPort,
  EmailVerification,
} from "./identity-data-contracts.ts";
/** Portable document, collaboration and compatibility contracts. Family-owned types are reexported below. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Id = string;
export type SourceRevision = string;
export interface Viewport {
  x: number;
  y: number;
}
export interface Snapshot {
  /** Optional inert semantic capture, bound to sourceRevision; never executed. */
  rendered?: string;
  /** Zero is a static document view without an initialized app store. */
  schema: number;
  sourceRevision: SourceRevision;
  state: JsonObject;
  view: Viewport;
}
export interface RemoteReference {
  origin: string;
  share: string;
  head?: SourceRevision;
}
export interface CommentDraft {
  id: Id;
  nodeId: Id | null;
  quote: string;
  body: string;
  sourceRevision: SourceRevision;
  parentId: Id | null;
}
export interface Comment extends CommentDraft {
  appStateId: Id | null;
  publishedBy: string | null;
  createdAt: string;
  revision?: number;
  resolved?: boolean;
  fingerprint?: string;
  sequence?: number;
}
export interface AcceptedComment extends Comment {
  publishedBy: string;
  revision: number;
  resolved: boolean;
  /** Non-secret text fingerprint detects stale app state; not an authorization check. */
  fingerprint: string;
  sequence: number;
}
export interface DocumentState {
  format: 1;
  fileId: Id | null;
  sourceRevision: SourceRevision;
  remote: RemoteReference | null;
  anchors: Record<Id, { quote: string }>;
  comments: Comment[];
  pending: Id[];
  app: Snapshot | null;
  snapshots: Record<Id, Snapshot>;
  sources?: Record<SourceRevision, string>;
  publishRequest: Id;
  contextOnly?: boolean;
  profiles?: Record<string, Profile>;
}
export interface SharedFile {
  access?: AccessPolicy;
  path?: string;
  /** Current portable read capability, never an account credential. */
  share?: string | null;
  owner: string;
  shareHash: string;
  generation: number;
  head: SourceRevision;
  sources: Record<SourceRevision, string>;
  comments: Record<Id, AcceptedComment>;
  snapshots: Record<Id, Snapshot>;
  sequence: number;
}
export interface Cursor {
  nodeId: Id;
  x: number;
  y: number;
}
/** Ephemeral offsets into public DOM text; never includes selected text. */
export interface SelectionRange {
  nodeId: Id;
  start: number;
  end: number;
  length: number;
  /** Non-secret text fingerprint detects stale app state; not an authorization check. */
  fingerprint: string;
}
export interface SelectionPresence {
  ranges: SelectionRange[];
}
export interface SharingPreferences {
  visible: boolean;
  shareCursor: boolean;
  shareView: boolean;
  showCursors: boolean;
  shareSelection: boolean;
  showSelections: boolean;
}
export interface PresenceInput extends Partial<SharingPreferences> {
  sessionId: Id;
  sourceRevision?: SourceRevision;
  cursor?: Cursor | null;
  selection?: SelectionPresence | null;
  snapshot?: Snapshot | null;
}
export interface PresenceEntry {
  actor: string;
  sessionId: Id;
  sourceRevision: SourceRevision;
  cursor: Cursor | null;
  selection?: SelectionPresence | null;
  snapshot: Snapshot | null;
  lastSeen: number;
  generation: number;
}
export interface Viewer {
  actor: string;
  sessionId: Id;
  sourceRevision: SourceRevision;
  cursor: Cursor | null;
  selection?: SelectionPresence | null;
  shareView: boolean;
}
export interface PresenceClock {
  now: number;
  generation: number;
  ttl?: number;
}
export interface ViewSession {
  current: Snapshot | null;
  own: { snapshot: Snapshot | null } | null;
}
export interface DomainError extends Error {
  status: number;
}
export interface AcceptOptions {
  digest: (canonical: string) => string;
  now: number;
}
export interface AcceptedResult {
  file: SharedFile;
  comment: AcceptedComment;
  created: boolean;
}
export interface EditResult {
  file: SharedFile;
  comment: AcceptedComment;
}
export interface CommentEdit {
  body?: string;
  resolved?: boolean;
}
export interface Context {
  comment: Comment;
  snapshot: Snapshot | null;
  source: string;
}
export interface Capture {
  appStateId: Id;
  snapshot: Snapshot;
  source: string;
}
export interface CommentsResponse {
  comments: AcceptedComment[];
  head: SourceRevision;
}
export interface Publication {
  fileId: Id;
  sourceRevision: SourceRevision;
  share: string;
}
export interface PublishRequest {
  visibility?: Visibility;
  linkRole?: ShareRole;
  path?: string;
  source: string;
  requestId: Id;
}
export interface PairRequest {
  fileId: Id;
}
export interface PairChallenge {
  deviceCode: string;
  code: string;
}
export type PairResponse =
  | { pending: true }
  | { token: string; username: string; publication?: Publication };
export type Theme = "light" | "dark";
export interface Profile {
  name: string;
  image: string | null;
}
export interface CommentRailItem {
  id: Id;
  top: number;
}
export interface ServerState {
  emailChallenges?: Record<string, EmailChallenge>;
  accounts: Record<string, Account>;
  tokens: Record<string, SessionGrant>;
  files: Record<Id, SharedFile>;
  publications: Record<string, Publication>;
}

/** I/O ports: the domain model never invokes these itself. Adapters own side effects. */
export interface Clock {
  now(): number;
}
export interface IdentityGenerator {
  next(): Id;
}
export interface HashPort {
  digest(canonical: string): string;
}
export interface FileSnapshot {
  html: string;
  etag: string;
}
export interface FileRepository {
  read(path: string): FileSnapshot;
  update(
    path: string,
    expected: string,
    transform: (html: string) => string,
  ): FileSnapshot;
}
export interface PreviewConnection {
  token: string;
  etag: string;
}
export interface PreviewPort {
  write(state: DocumentState, expectedEtag: string): Promise<{ etag: string }>;
}
export interface CollaborationPort {
  comments(): Promise<CommentsResponse>;
  comment(
    comment: CommentDraft,
    snapshot: Snapshot | null,
  ): Promise<AcceptedComment>;
  edit(
    id: Id,
    expectedRevision: number,
    edit: CommentEdit,
  ): Promise<AcceptedComment>;
  context(id: Id): Promise<Context>;
  presence(input: PresenceInput): Promise<void>;
  viewers(): Promise<Viewer[]>;
  capture(sessionId: Id): Promise<Capture>;
}
export interface AuthPort {
  begin(fileId: Id, share: string): Promise<PairChallenge>;
  poll(deviceCode: string): Promise<PairResponse>;
}
export interface Target {
  id: Id;
  quote: string;
  rect: { x: number; y: number; width: number; height: number };
}
export type AppMessage =
  | {
      pagegi: true;
      kind: "context";
      nodeId: Id | null;
      quote: string;
      snapshot: Snapshot;
      x: number;
      y: number;
    }
  | { pagegi: true; kind: "dismiss" }
  | {
      pagegi: true;
      kind: "view";
      snapshot: Snapshot | null;
      targets: Target[];
      /** False while the design system's stylesheet is still loading; the loading screen waits for it. */
      styled?: boolean;
    }
  | {
      pagegi: true;
      kind: "pick";
      nodeId: Id | null;
      quote: string;
      snapshot: Snapshot | null;
    }
  | { pagegi: true; kind: "cursor"; cursor: Cursor }
  | { pagegi: true; kind: "save"; id: Id }
  | { pagegi: true; kind: "error"; message: string };
export type HostMessage =
  | { pagegi: true; kind: "theme"; theme: Theme }
  | { pagegi: true; kind: "mode"; on: boolean }
  | { pagegi: true; kind: "status"; status: RuntimeStatus }
  | { pagegi: true; kind: "saved"; id: Id; result?: SaveResult; error?: string }
  | { pagegi: true; kind: "scroll"; view: Viewport };

/** Pure transition surface shared by browser, CLI and server. */
export interface CollaborationModel {
  localComment(
    state: DocumentState,
    draft: CommentDraft,
    snapshot: Snapshot | null,
    snapshotId: Id | null,
    now?: number,
  ): DocumentState;
  /**
   * Delayed acknowledgments must never downgrade an accepted comment revision.
   * `localId` is the ID the comment had before the server chose its own; the
   * comment and replies to it move to the server's ID.
   */
  acknowledge(
    state: DocumentState,
    accepted: AcceptedComment,
    localId?: string,
  ): DocumentState;
  /** Merge monotonically by revision; preserve unsent local comments. */
  mergeComments(state: DocumentState, remote: AcceptedComment[]): DocumentState;
  compact(state: DocumentState, recent?: number): DocumentState;
  acceptComment(
    file: SharedFile,
    actor: string,
    draft: CommentDraft,
    snapshot: Snapshot | null,
    options: AcceptOptions,
  ): AcceptedResult;
  editComment(
    file: SharedFile,
    actor: string,
    owner: boolean,
    id: Id,
    expected: number,
    edit: CommentEdit,
  ): EditResult;
  presenceUpdate(
    entries: Record<Id, PresenceEntry>,
    actor: string,
    input: PresenceInput,
    clock: PresenceClock,
  ): Record<Id, PresenceEntry>;
  visiblePresence(
    entries: Record<Id, PresenceEntry>,
    clock: PresenceClock,
  ): Viewer[];
  capturePresence(
    entries: Record<Id, PresenceEntry>,
    sessionId: Id,
    clock: PresenceClock,
  ): Snapshot;
  enterView(session: ViewSession, snapshot: Snapshot | null): ViewSession;
  leaveView(session: ViewSession): ViewSession;
  replaceSource(
    state: DocumentState,
    previousSource: string,
    revision: SourceRevision,
  ): DocumentState;
}

/** First publication is available from both the CLI and the file's top bar. */
export interface PublishPairRequest extends PublishRequest {
  sources?: Record<SourceRevision, string>;
}
export interface PublicationOptions {
  fileId: Id;
  share: string;
  digest(value: string): string;
  revision(source: string): SourceRevision;
}
export interface PublicationResult {
  state: ServerState;
  publication: Publication;
  created: boolean;
}
export interface PublicationModel {
  createPublication(
    state: ServerState,
    actor: string,
    request: PublishPairRequest,
    options: PublicationOptions,
  ): PublicationResult;
}

/** One connection subscribes to one file. Credentials travel only in the first frame. */
export type LiveClientMessage =
  | {
      type: "auth";
      token: string;
      sessionId: Id;
      sourceRevision: SourceRevision;
    }
  | { type: "presence"; presence: PresenceInput }
  | { type: "cursor"; cursor: Cursor | null };
export type LiveServerMessage =
  | { type: "ready" }
  | { type: "heartbeat" }
  | { type: "viewers"; viewers: Viewer[] }
  | { type: "changed" }
  | { type: "error"; message: string };
export interface LiveAuthorization {
  file: SharedFile;
  actor: string | null;
  expires: number;
}
export interface LiveHub {
  /** Called only after a durable mutation commits. Revocation closes existing readers. */
  changed(fileId: Id, revoke?: boolean): void;
  presenceChanged(fileId: Id, generation: number): void;
  close(): void;
}

/** The library lists only owned documents; opening uses the portable runtime. */
export interface LibraryFile {
  path: string;
  /** Canonical owner namespace qualified document address. */
  url: string;
  fileId: Id;
  sourceRevision: SourceRevision;
  title: string;
  commentCount: number;
}
export interface BrowserSession {
  username: string;
}
export interface HostedBoot {
  path?: string;
  token: string | null;
  username: string | null;
  permissions: FilePermissions;
  home: string;
}

/** Validated same-origin page destination after authentication: one of the page address forms (src/ids/file-id-contracts.ts). */
export type LoginDestination =
  | `/a/${string}`
  | `/@${string}`
  | `/af/v1/ids/${string}`
  | `/connect${string}`;
/** Authentication resolves before any route-specific content becomes visible. */
export type HomeScreen =
  | "loading"
  | "welcome"
  | "library"
  | "account"
  | "error";
export interface HomeNavigation {
  session: "pending" | "signed-in" | "signed-out" | "failed";
  account: boolean;
}

/** Paths belong to an account; IDs remain stable across moves and renames. */
export interface PathEntry {
  /** Present on API file entries; always owner namespace qualified. */
  url?: string;
  path: string;
  fileId: string | null;
}
export type PathChange =
  | { kind: "folder"; path: string }
  | { kind: "move"; from: string; path: string }
  | { kind: "move-many"; paths: string[]; destination: string }
  | { kind: "remove-folder"; path: string };
export interface CommentInteraction {
  active: string | null;
  pinned: boolean;
  expanded: boolean;
  drafts: Record<string, string>;
}
export type CommentInteractionEvent =
  | { kind: "hover" | "open" | "expand"; id: string }
  | { kind: "leave" | "close" }
  | { kind: "draft"; id: string; body: string }
  | { kind: "sent"; id: string };
/** Publication API receipt, enriched with the account's current readable path. */
export interface PublicationReceipt extends Publication {
  path: string;
  url: string;
}
export interface PathCatalogResponse {
  entries: PathEntry[];
}

/** Remote authorization never restricts a recipient's already-downloaded offline copy. */
export type Visibility = "public" | "unlisted" | "private";
export type ShareRole = "viewer" | "commenter" | "editor";
export interface AccessPolicy {
  visibility: Visibility;
  linkRole: ShareRole;
  shares: Record<string, ShareRole>;
  version: number;
}
export interface FilePermissions {
  role: ShareRole | "owner" | null;
  read: boolean;
  comment: boolean;
  edit: boolean;
  manage: boolean;
}
export type AccessPatch =
  | { visibility: Visibility }
  | { linkRole: ShareRole }
  | { email: string; role: ShareRole | null };
export interface SharingResponse {
  policy: AccessPolicy;
  permissions: FilePermissions;
  url: string;
  owner: string;
}

/** Trusted frame geometry; annotation paint never intercepts app input. */
export interface CommentTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CommentHighlight {
  nodeId: string;
  rect: CommentTargetRect;
  emphasis: "active" | "quiet";
}

/** Durability is independent from cached collaboration metadata. */
export interface DurabilityState {
  hosted: boolean;
  fileDirty: boolean;
  recoveryFailed: boolean;
  pendingComments: number;
  drafts: Record<string, string>;
}
export interface ViewRecovery {
  format: 1;
  sourceRevision: SourceRevision;
  snapshot: Snapshot | null;
}

export type RunnerURLParser = (value: string, base: string) => URL;
