import {hostedAuthorization,hostedRefusal,hostedOperationCompleted} from '@/lib/accounts/request-authority';
import {adaptMutationOperationReply,mutationInitiator,normalizeMutationOperation} from '@/lib/artifacts/mutation-operation';
import {MembershipError} from '@/lib/artifacts/membership/membership';
import {refusingUnservable} from '@/lib/artifacts/servable';
import {grantsOf,grantsPermitWrite} from '@/lib/artifacts/dataset-policy/grants';
import {tokenActorForRequest} from '@/lib/accounts/viewer';
import {readableArtifact} from '@/lib/artifacts/read-access';
import {canAnnotate} from '@/lib/artifacts/share-roles';
import {durableMutation} from '@/lib/artifacts/mutation-receipt';
import { getArtifactFor, getArtifactById } from '@/lib/artifacts/store';
import { canReadArtifact } from '@/lib/artifacts/access';
import {ownedArtifactState} from '@/lib/workspace/trash';
import {sessionOwnedBy} from '@/lib/remote/resource';
/**
 * The HTTP half of the operations registry: a bearer route is a TRANSLATION
 * LAYER — it gathers the input (JSON body + path params + the odd query
 * flag), builds the transport context, and maps the operation's reply back
 * to a Response. No route holds protocol semantics of its own; those live in
 * the operation's `run` (which is itself the shared lib/artifact-wire
 * pipeline).
 */
import { json, baseUrl } from '@/lib/http/http';
import type { TokenActor } from '@/lib/accounts/actors';
import type { AnnotationAuthor } from '@artifactbin/contracts';
import { OPERATIONS, type OpContext, type Operation, type OpReply } from './registry';

/**
 * The idempotency allowlist, and the authorization that runs BEFORE a receipt
 * is claimed for each entry.
 *
 * Two rules shape this table. A receipt is a claim on a name in this account's
 * key space, so a stranger must never be able to claim one — hence a check at
 * all. And the check must be about AUTHORITY, never about the state the
 * operation is going to change: delete, restore and terminate each flip the
 * state a naive existence check would read, so a liveness check would refuse
 * precisely the retry the receipt exists to answer.
 */
const AUTHORIZED: Record<string, (actor: TokenActor, input: Record<string, unknown>) => Promise<boolean>> = {
  mutate_dataset: async (actor, input) => {const row=await getArtifactById(String(input.id));return !!row&&(input.name?await canReadArtifact(row,actor.userId?{userId:actor.userId,email:null}:null)||row.token_id===actor.tokenId:grantsOf(row)?await grantsPermitWrite(row,actor)||!!await getArtifactFor(actor,row.id):!!await getArtifactFor(actor,row.id));},
  annotate: async (actor, input) => {
    const access = await readableArtifact(actor, String(input.id));
    return !!access && canAnnotate(access.role);
  },
  // Owner scope read past the trash gate: a trashed row is still this account's.
  delete_artifact: async (actor, input) => !!(await ownedArtifactState(actor, String(input.id))),
  restore_artifact: async (actor, input) => !!(await ownedArtifactState(actor, String(input.id))),
  // With a document named, the document is the authority. A bare url carries
  // its own: `refresh_asset` imports nothing, so a url this account never
  // stored answers `not_cached` per url inside the reply rather than moving
  // any bytes, and the bearer credential is the whole permission needed.
  refresh_asset: async (actor, input) =>
    typeof input.id === 'string' && input.id ? !!(await getArtifactFor(actor, input.id)) : true,
  terminate_remote_session: async (actor, input) => sessionOwnedBy(actor, String(input.id)),
};

function operation(name: string): Operation {
  const op = OPERATIONS.find((o) => o.name === name);
  if (!op) throw new Error(`no operation named ${name}`);
  return op;
}

function opResponse(reply: OpReply): Response {
  if (reply.image) {
    return new Response(Buffer.from(reply.image.base64, 'base64'), {
      status: reply.status,
      headers: { 'Content-Type': reply.image.mimeType, ...(reply.headers ?? {}) },
    });
  }
  return json(reply.body, reply.status, reply.headers);
}

/**
 * The whole translation: context from the request, input from the caller,
 * reply to Response. `author` matters only to `annotate`; the default names
 * an HTTP agent with no display header honestly.
 */
export async function runOperation(
  name: string,
  request: Request,
  actor: TokenActor,
  input: Record<string, unknown>,
  author: AnnotationAuthor = { kind: 'agent', label: null, transport: 'http' },
): Promise<Response> {
  actor = tokenActorForRequest(request, actor);
  const scope=await hostedAuthorization(actor.userId,actor.tokenId,name,input);
  const refusal=hostedRefusal(scope);if(refusal)return refusal;
  const complete=async(response:Response)=>{if(scope.kind==='allowed')await hostedOperationCompleted(actor.userId,actor.tokenId,name,input,response);return response;};
  const ctx: OpContext = { ...(scope.kind==='allowed'&&scope.requestScope!==undefined?{requestScope:scope.requestScope}:{}),actor, base: baseUrl(request), request, author };
  const key=request.headers.get('Idempotency-Key');
  const authorize=AUTHORIZED[name];
  if(authorize&&key){
    if(!await authorize(actor,input))return json({error:'not_found'},404);
    const payload=name==='mutate_dataset'&&typeof input.name==='string'?normalizeMutationOperation({documentId:String(input.id),mutation:input.name,args:(input.args??{}) as Record<string,string|number|boolean|null>,...(input.row!==undefined?{row:input.row as Record<string,string|number|boolean|null>}:{}),...(input.value!==undefined?{value:input.value as string|number|boolean|null}:{}),...(typeof input.tz==='string'?{tz:input.tz}:{}),...(typeof input.expectedState==='string'?{expectedState:input.expectedState}:{})}):{name,input};
    const saved=await durableMutation(actor,ctx.base,key,payload,receipt=>operation(name).run({...ctx,mutationReceipt:receipt},input),{initiator:mutationInitiator(actor,'agent',author.kind==='agent'?author.label:null)});
    const result=adaptMutationOperationReply(saved,'api');
    const terminal=!['operation_pending','outcome_unknown','idempotency_mismatch','invalid_idempotency_key'].includes(String(result.body.error));
    return complete(opResponse({...result,...(terminal?{headers:{'X-Artifactbin-Mutation-Receipt':key}}:{})}));
  }
  // A stored shape the current code no longer serves is its 410 at every operation (lib/artifacts/servable).
  return complete(await refusingUnservable(async()=>{try{return opResponse(await operation(name).run(ctx, input));}catch(error){if(error instanceof MembershipError)return json({error:'mention_refused',detail:error.message},error.status);throw error;}}));
}
