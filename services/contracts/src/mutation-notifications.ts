/** Standalone notification-query foundation. Types only; no runtime installed. */
import type { Queryable } from './db';
import type { ColumnType, PersonCard, Scalar } from './sql';

/** Direct Helmet child. SQL returns to/message; no reactive page subscription. */
export interface MutationNotificationRule {
  name: string;
  on: string;
  sql: string;
}

/** Authenticated principal is authoritative; execution describes transport, not permission. */
export interface MutationInitiator {
  principal:
    | { kind: 'user'; id: string }
    | { kind: 'token'; id: string }
    | { kind: 'anonymous' }
    | { kind: 'system' };
  execution: 'human' | 'agent' | 'system';
  /** Optional descriptive client label; may be self-reported. Never an ACL input. */
  agentLabel: string | null;
}

/** Canonical explicit request inputs for persistent document-action replay. */
export interface MutationOperationRequest {
  documentId: string;
  mutation: string;
  args: Record<string, Scalar>;
  row?: Record<string, Scalar>;
  value?: Scalar;
  tz?: string;
  expectedState?: string;
}

/**
 * Persist this successful domain outcome once; route adapters render it to their
 * existing API/browser shapes on BOTH first response and replay. No effect images.
 */
export interface MutationOperationSuccess {
  datasetId: string;
  datasetEditId: string;
  version: number;
  affected: number;
  rowCount: number;
  /** Present for notification-bearing runs; same discoverable handle on replay. */
  mutationRunId?: string;
}

/** Frozen source identity; current data and current permissions are read at execution. */
export interface NotificationSource {
  artifactId: string;
  schema: string;
  table: string;
  /** Server-produced authority revision/fence to recheck before result commit. */
  authorityRevision: string;
  /** Must remain compatible with the saved definition; never rebind by table name alone. */
  schemaRevision: string;
}

/** Opaque durable identity, never raw request keys or credentials. */
export interface MutationNotificationOrigin {
  mutationRunId: string;
  documentId: string;
  documentEditId: string;
  documentVersion: number;
  mutationName: string;
  /** Document-scoped Notify name; unique job key is mutationRunId + ruleId. */
  ruleId: string;
}

/** Logical normalized run inputs, before SQL placeholder rewriting. */
export interface MutationNotificationBindings {
  values: Record<string, Scalar>;
  types: Record<string, ColumnType>;
  userId: string | null;
  now: string;
  tz: string;
}

/** Claimed before execution; persisted with the winning mutation, never its row images. */
export interface MutationNotificationJobInput {
  origin: MutationNotificationOrigin;
  initiator: MutationInitiator;
  rule: MutationNotificationRule;
  /** Immutable effective values/defaults plus server-established run context. */
  bindings: MutationNotificationBindings;
  /** Canonical hash of the strictly validated immutable compiled snapshot below. */
  contextRevision: string;
  /** JSON-only app compiled context, validated at its owning boundary; never credentials. */
  contextSnapshot: Record<string, unknown>;
}

export interface MutationNotificationClaim {
  jobId: string;
  /** Monotonic fencing token; a stale worker cannot complete or fail a new claim. */
  generation: number;
  leaseUntil: string;
  input: MutationNotificationJobInput;
}

/** Validated query output. Nulls skip; users deduplicate within this result row. */
export interface ResolvedMutationNotification {
  recipientIds: string[];
  message: string;
}

/** Output order is frozen once; no promise of stable SQL order across attempts. */
export interface MutationNotificationPlan {
  /** Recheck originating principal/document authority even when sources is empty. */
  executionFence: { principalRevision: string; documentRevision: string; contextRevision: string };
  rows: ResolvedMutationNotification[];
  /** Every relation contributing data OR predicates, including transitive dependencies. */
  sources: NotificationSource[];
}

export type MutationNotificationJobStatus =
  | 'pending' | 'running' | 'retrying' | 'completed' | 'failed';

/** Operational view excludes SQL, arguments, credentials and message content. */
export interface MutationNotificationJobView {
  id: string;
  mutation_run_id: string;
  notification_name: string;
  status: MutationNotificationJobStatus;
  attempts: number;
  error_code: string | null;
  next_attempt_at: string | null;
}

export type MutationNotificationActor =
  | { kind: 'user'; userId: string; person: PersonCard; viaAgent: boolean }
  | { kind: 'agent' | 'token' | 'anonymous' | 'system' | 'deleted-user' };

/** Actor is the initiator of the trigger; message describes current query state. */
export interface MutationNotificationView {
  id: string;
  kind: 'mutation';
  artifact_id: string;
  title: string | null;
  actor: MutationNotificationActor;
  message: string;
  mutation_run_id: string;
  notification_name: string;
  output_ordinal: number;
  mutation_name: string;
  revision: number;
  read_at: string | null;
  created_at: string;
}

export interface MutationNotificationEvaluator {
  /** Read-only, current caller/document/source authority. No side effects or page state. */
  evaluate(input: MutationNotificationJobInput): Promise<MutationNotificationPlan>;
}

export interface MutationNotificationJobStore {
  /** Winning local write transaction: dataset pointer + receipt + all jobs or none. */
  enqueue(tx: Queryable, inputs: MutationNotificationJobInput[]): Promise<void>;
  /** Atomically claims pending/due/expired work with a new fence. */
  claim(): Promise<MutationNotificationClaim | null>;
  /** False means the lease/fence is lost; stale workers must discard their output. */
  renew(claim: MutationNotificationClaim): Promise<boolean>;
  /**
   * Own transaction: verify claim/initiator/document/source schema and authority fences, admit recipients against current full-source read
   * authority, insert all bounded inbox rows/ID-only outbox facts and mark completed.
   * Empty plans complete too. Failure rolls back THIS transaction, not the mutation.
   * False means another attempt owns/completed the job. Never overwrite saved results.
   */
  complete(claim: MutationNotificationClaim, plan: MutationNotificationPlan): Promise<boolean>;
  /** Fence-checked backoff or visible terminal failure; never stores raw exception SQL/data. */
  fail(claim: MutationNotificationClaim, code: string, retryable: boolean): Promise<boolean>;
  /** Current authorization: original principal or document manager, never ordinary readers. */
  list(principal: MutationInitiator['principal'], mutationRunId: string): Promise<MutationNotificationJobView[]>;
  status(principal: MutationInitiator['principal'], jobId: string): Promise<MutationNotificationJobView | null>;
  /** Only failed jobs; retain original definition/bindings/identity and audit who retried. */
  retry(principal: MutationInitiator['principal'], jobId: string): Promise<boolean>;
}
