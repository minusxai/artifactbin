import {PUBLIC_BASE_URL} from './platform/config';
import type {CapabilityContext} from '@artifactbin/runner/local';
import {runnerIdentity} from '@artifactbin/runner/capabilities';
import {lambdaOperation} from './runner/operations';
import {z} from 'zod';
import {actorOf,attachActor} from '@artifactbin/utils';
import {sessionActor,isCookieCredential} from './accounts';
import {getArtifactById} from './artifacts';
import {OPERATIONS} from './operations/registry';
import {runOperation} from './operations/http';
import {json,isCrossSiteRequest} from './http';
import {editHostedDocument} from './operations/hosted-tools';
/** Trusted host uses the same operation registry and ACLs as the CLI. No caller-controlled identity. */
export async function runnerOperation(request: Request, operation: string, input: Record<string, unknown>, documentSource?:string) {
    if(operation.startsWith('lambda_'))return lambdaOperation(request,operation,input,documentSource);
    const identity = actorOf(request);
    if (!identity?.userId)
        return json({ error: 'unauthorized' }, 401);
    // A document's handler runs as whoever started it: account operations only when that is the artifact's own owner.
    if (identity.runner) {
        const source = await getArtifactById(identity.runner.artifactId);
        if (!source || source.user_id !== identity.userId)
            return json({ error: 'operation_not_allowed' }, 403);
    }
    const actor = await sessionActor(request);
    if (isCookieCredential(actor) && isCrossSiteRequest(request))
        return json({ error: 'forbidden' }, 403);
    if (!actor.userId && !actor.tokenId)
        return json({ error: 'unauthorized' }, 401);
    // Internal transport addresses are never reader-facing artifact URLs.
    const headers = new Headers(request.headers);
    const publicUrl = new URL(PUBLIC_BASE_URL);
    headers.set('x-forwarded-host', publicUrl.host);
    headers.set('x-forwarded-proto', publicUrl.protocol.slice(0,-1));
    request = attachActor(new Request(new URL('/api/runner/operations', publicUrl), {method:request.method,headers}),identity);
    if(operation==='edit_document')return editHostedDocument(request,actor,input);
    const allowed = new Set(['create_artifact', 'get_artifact', 'query_resource', 'mutate_dataset', 'annotate', 'list_artifacts', 'update_artifact']);
    if (!allowed.has(operation))
        return json({ error: 'operation_not_allowed' }, 403);
    const spec = OPERATIONS.find(op => op.name === operation)!;
    const parsed = z.object(spec.input).safeParse(input);
    if (!parsed.success)
        return json({ error: 'invalid_operation_input' }, 400);
    return runOperation(operation, request, actor, parsed.data);
}
export function localRunnerOperation(userId: string, operation: string, input: Record<string, unknown>, context?:CapabilityContext) {
    return runnerOperation(attachActor(new Request('http://artifactbin.internal/internal/runner/operations', { method: 'POST' }), context?runnerIdentity(context):{ userId, credential: 'session' }), operation, input, context?.request.document?.source);
}
