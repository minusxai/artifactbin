/**
 * Mutation notification contracts, seeded before implementation. Static data only:
 * no JSX evaluation, delivery code, or app imports. See docs/mutation-notifications.md.
 * SQL capture is independent of this declaration and lives in sql.ts.
 */
import type { Queryable } from './db';
import type { MutationEffect, PersonCard, Scalar } from './sql';

export interface MutationNotificationField {
  snapshot: 'before' | 'after';
  field: string;
}

export type MutationNotificationRecipient =
  | { kind: 'field'; ref: MutationNotificationField }
  | { kind: 'user'; id: string };

export type MutationNotificationPart =
  | { kind: 'text'; text: string }
  | { kind: 'field'; ref: MutationNotificationField };

/** One optional Notify per declaration. Null literal recipients normalize away. */
export interface MutationNotificationSpec {
  to: MutationNotificationRecipient[];
  message: MutationNotificationPart[];
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
}

/** Internal provenance. Exact source and committed target heads, never credentials. */
export interface MutationNotificationOrigin {
  /** Platform-derived opaque identity of the durable scoped invocation, not its raw key. */
  invocationId: string;
  documentId: string;
  documentEditId: string;
  documentVersion: number;
  mutationName: string;
  /** Exactly one declaration today; included in the dedupe key for future compatibility. */
  declarationIndex: 0;
  datasetId: string;
  datasetEditId: string;
  table: { schema: string; name: string };
}

/** Pure resolution is not authorization: the commit module must admit each recipient. */
export interface ResolvedMutationNotification {
  recipientIds: string[];
  /** Plain action phrase; never HTML. Stored in app-owned content, not the event service. */
  actionText: string;
}

export interface MutationNotificationCommit {
  origin: MutationNotificationOrigin;
  initiator: MutationInitiator;
  /** Array index matches the winning effects ordinal, including empty recipient sets. */
  resolved: ResolvedMutationNotification[];
}

/** Internal principal details never cross this presentation boundary. */
export type MutationNotificationActor =
  | { kind: 'user'; userId: string; person: PersonCard; viaAgent: boolean }
  | { kind: 'agent' | 'token' | 'anonymous' | 'system' | 'deleted-user' };

/** New inbox variant; legacy notification variants retain their existing shapes. */
export interface MutationNotificationView {
  id: string;
  kind: 'mutation';
  artifact_id: string;
  title: string | null;
  actor: MutationNotificationActor;
  action_text: string;
  /** Safe grouping metadata; counts must only include this recipient’s visible items. */
  invocation_id: string;
  effect_ordinal: number;
  mutation_name: string;
  revision: number;
  read_at: string | null;
  created_at: string;
}

/** App implementations stay behind these seams; no implementation is installed by this seed. */
export interface MutationNotificationResolver {
  resolve(spec: MutationNotificationSpec, effect: MutationEffect): ResolvedMutationNotification;
}

export interface MutationNotificationWriter {
  /**
   * Caller supplies the winning dataset transaction. All queries use tx; failure
   * rolls back the write and receipt. Resolve account kind through tx; check both
   * block directions and testuser isolation, never trusting descriptive provenance.
   * Enqueue IDs only; external delivery is later.
   */
  commit(tx: Queryable, input: MutationNotificationCommit): Promise<void>;
}
