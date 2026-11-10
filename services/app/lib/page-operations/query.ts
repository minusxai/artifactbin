/**
 * `caps.query(graphql, variables)` for resolvers, on the host: the Hasura-style API over the datasets the
 * page links, run AS THE CALLER. The caller (subject and page role) is the one the app admitted the run for, read
 * from the admitted request in process or from the signed runner pin remotely; resolver arguments never name it.
 * The dataset role is each dataset's own sharing under the page audience rule (lib/dataset-permissions), never the
 * page owner's rights, so a resolver can validate and derive but never grant more than the caller has.
 */
import { RESOLVER_LIMITS, type DatasetGraphqlReply, type DatasetGraphqlRequest, type HtmlDatasetLink, type Queryable, type RunnerCaller, type RunnerJson } from '@artifactbin/contracts';
import { identityForUser, type AccessActor } from '@/lib/accounts';

/** A refusal handed to resolver code as an Error with `code` (and the remote callback's `code: detail`). */
export class ResolverQueryError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    const line = detail?.split(/\r?\n/, 1)[0]!.replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 200);
    super(line ? `${code}: ${line}` : code);
    this.name = 'ResolverQueryError';
    this.code = code;
  }
}

interface ResolverQueryInput {
  /** The page the resolver version belongs to (the admitted backend's `pageId`). */
  pageId: string;
  /** Who called, as admitted; null when the run's attestation carries no caller (refused). */
  caller: RunnerCaller | null;
  /** The resolver operation the run was admitted as. */
  operation: 'query' | 'mutation' | undefined;
  args: RunnerJson;
  signal?: AbortSignal;
}
export type ResolverQuery = (input: ResolverQueryInput) => Promise<RunnerJson>;

export interface ResolverQueryPorts {
  /** The datasets the page links now (its head), live and pinned. */
  links(pageId: string): Promise<readonly HtmlDatasetLink[]>;
  /**
   * The page head as one read: its dataset links and the guard its writes commit under (lib/page-graphql: that head,
   * those links and the caller's access, decided again inside the write's transaction). Mutations use it when given.
   */
  page?(pageId: string, actor: AccessActor): Promise<{ links: readonly HtmlDatasetLink[]; commitGuard: (tx: Queryable) => Promise<void> }>;
  /** lib/dataset-graphql `executeLinkedDatasetGraphql`: the page audience rule over each dataset's own sharing. */
  execute(actor: AccessActor, links: readonly HtmlDatasetLink[], request: DatasetGraphqlRequest, options: { operation: 'query' | 'mutation' | undefined; resultBytes: number; pageId: string; commitGuard?: (tx: Queryable) => Promise<void> }, signal: AbortSignal): Promise<DatasetGraphqlReply>;
}


const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** The generated API's codes as resolver refusals (the plan's permission_denied, validation_failed, conflict, unavailable). */
const CODES: Record<string, string> = { dataset_changed: 'conflict', dataset_not_found: 'unavailable', unexpected: 'unavailable' };

export function createResolverQuery(ports: ResolverQueryPorts): ResolverQuery {
  return async ({ pageId, caller, operation, args, signal }) => {
    if (!caller) throw new ResolverQueryError('caller_unavailable', 'the run does not attest who called');
    if (!isObject(args) || typeof args.query !== 'string') throw new ResolverQueryError('validation_failed', 'caps.query takes a GraphQL document string');
    if (Buffer.byteLength(args.query) > RESOLVER_LIMITS.queryDocumentBytes) throw new ResolverQueryError('validation_failed', `a query document is at most ${RESOLVER_LIMITS.queryDocumentBytes} bytes`);
    if (args.variables !== undefined && args.variables !== null && !isObject(args.variables)) throw new ResolverQueryError('validation_failed', 'variables must be an object');
    if (args.operationName !== undefined && args.operationName !== null && typeof args.operationName !== 'string') throw new ResolverQueryError('validation_failed', 'operationName must be a string');
    if (args.idempotencyKey !== undefined && args.idempotencyKey !== null && typeof args.idempotencyKey !== 'string') throw new ResolverQueryError('validation_failed', 'idempotencyKey must be a string');
    // A mutation's key names its durable receipt (a retried resolver replays it); without one the server makes one.
    const request: DatasetGraphqlRequest = { query: args.query, ...(isObject(args.variables) ? { variables: args.variables } : {}), ...(typeof args.operationName === 'string' ? { operationName: args.operationName } : {}), ...(typeof args.idempotencyKey === 'string' ? { idempotencyKey: args.idempotencyKey } : {}) };
    // The caller's account, nothing more: no token, email or host grant reaches the dataset decision.
    const actor = identityForUser(caller.subject);
    let reply: DatasetGraphqlReply;
    try {
      // A write commits only while the head its links came from, and the caller's access to it, still hold.
      const head = operation === 'mutation' && ports.page ? await ports.page(pageId, actor) : null;
      reply = await ports.execute(actor, head?.links ?? await ports.links(pageId), request, { operation, resultBytes: RESOLVER_LIMITS.queryResultBytes, pageId, ...(head ? { commitGuard: head.commitGuard } : {}) }, signal ?? new AbortController().signal);
    } catch (e) {
      if (e instanceof Error && (e.message === 'dataset_changed' || e.message === 'dataset_not_found')) throw new ResolverQueryError(CODES[e.message]!);
      throw new ResolverQueryError('unavailable');
    }
    const first = reply.errors?.[0];
    if (first) throw new ResolverQueryError(CODES[first.extensions.code] ?? first.extensions.code, first.message);
    return (reply.data ?? null) as RunnerJson;
  };
}
