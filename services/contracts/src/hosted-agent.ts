import type { RemoteSessionInfo, RemoteView } from './remote';
import type { RunnerJson } from './runner';

/** A committed app outbox entry. requestId is stable across retries and must deduplicate acceptance. */
export interface HostedAgentComment {
  requestId: string;
  sessionId: string;
  artifactId: string;
  threadId: string;
  commentId: string;
  body: string;
  author: string | null;
  /** Frozen selected text, anchor and thread through the triggering comment; at most 64 KiB JSON. */
  commentContext?: RunnerJson;
  /** App-owned, authenticated operation callback; contains no bearer credentials. */
  callbackUrl: string;
}

/** Callback authentication is service-only and derived from the shared actor secret. */
export interface HostedAgentCommentOperation {
  requestId: string;
  sessionId: string;
  operation: 'read' | 'reply';
  input: RunnerJson;
}

/** Optional external managed-agent service. Session IDs identify, never authorize. */
export interface HostedRemoteAgent {
  owns(owner: string, id: string): boolean;
  ensure(owner: string): Promise<RemoteSessionInfo>;
  view(owner: string, id: string, since: number): Promise<RemoteView>;
  input(owner: string, id: string, text: string): Promise<void>;
  stop(owner: string, id: string): Promise<void>;
  deliverComment?(owner: string, comment: HostedAgentComment): Promise<void>;
  operation(owner: string, requestId: string, operation: string, args: RunnerJson): Promise<Response>;
}
