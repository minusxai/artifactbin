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

/** Token-bound default-request authorization. Ordinary human/native tokens retain their existing policy.
 * The app attests the scoped token; the private owner resolves its live branch. Caller headers never confer authority. */
export type HostedOperationAuthorization =
  | {kind:'ordinary'|'allowed'}
  | {kind:'denied';code:string;message:string}
  | {kind:'deferred';body:RunnerJson};

/** App-attested token metadata; never derived from caller headers or payload. */
export interface HostedCredentialDescriptor {name:string|null;expiresAt:string|null;scoped:boolean}

/** Optional external managed-agent service. Session IDs identify, never authorize. */
export interface HostedRemoteAgent {
  owns(owner: string, id: string): boolean;
  status?(owner:string):Promise<RemoteSessionInfo|null>;
  ensure(owner: string): Promise<RemoteSessionInfo>;
  view(owner: string, id: string, since: number): Promise<RemoteView>;
  input(owner: string, id: string, text: string): Promise<void>;
  stop(owner: string, id: string): Promise<void>;
  deliverComment?(owner: string, comment: HostedAgentComment): Promise<void>;
  authorizeOperation?(owner:string,tokenId:string,name:string,input:RunnerJson,credential?:HostedCredentialDescriptor):Promise<HostedOperationAuthorization>;
  operationCompleted?(owner:string,tokenId:string,name:string,input:RunnerJson,result:RunnerJson,credential?:HostedCredentialDescriptor):Promise<void>;
  operation(owner: string, requestId: string, operation: string, args: RunnerJson): Promise<Response>;
}
