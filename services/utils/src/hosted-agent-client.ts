import { createHash, createHmac } from 'node:crypto';
import type { HostedRemoteAgent, Upstream } from '@artifactbin/contracts';
import {overHttp} from './upstream';
import {signActor} from './actor-sign';

/** Stateless identity permits routing after app restart. Every service call still authenticates the owner. */
export const hostedAgentSessionId = (owner: string): string => createHash('sha256').update(`hosted:${owner}`).digest('hex');

/** Keep hosted work callbacks distinct from proxy-signed browser requests. */
export const hostedAgentCallbackKey = (secret: string): string => createHmac('sha256', secret).update('artifactbin/hosted-agent-callback/v1').digest('hex');

/** Comment delivery contains trusted callback routing, so browser proxy signatures must not authorize it. */
export const hostedAgentDeliveryKey = (secret: string): string => createHmac('sha256', secret).update('artifactbin/hosted-agent-delivery/v1').digest('hex');

/** Preserve service authorization even when an ordinary identity proxy rewrites x-mx-actor. */
export function hostedAgentTransport(base:string,secret:string):Upstream {
 const forward=overHttp(base,secret);
 return (request,actor)=>{const headers=new Headers(request.headers);headers.set('x-artifactbin-hosted-actor',signActor(actor,secret));return forward(new Request(request,{headers}),actor);};
}

export function hostedAgentDeliveryTransport(base:string,secret:string):Upstream {
 const forward=hostedAgentTransport(base,secret);
 return (request,actor)=>{const headers=new Headers(request.headers);headers.set('x-artifactbin-hosted-delivery',signActor(actor,hostedAgentDeliveryKey(secret)));return forward(new Request(request,{headers}),actor);};
}

export function hostedAgentClient(base: string, forward: Upstream, commentForward?: Upstream): HostedRemoteAgent {
  const parsed = new URL(base);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !['http:', 'https:'].includes(parsed.protocol))
    throw Error('hosted_agent_service_url_invalid');
  const origin = parsed.origin;
  async function request(owner: string, path: string, body: unknown, transport: Upstream = forward): Promise<Response> {
    const response = await transport(new Request(origin + '/v1/agents' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    }), { userId: owner, credential: 'session' });
    return response;
  }
  async function json<T>(owner: string, path: string, body: unknown): Promise<T> {
    const response = await request(owner, path, body);
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      throw Error(result.error ?? 'hosted_agent_unavailable');
    }
    return response.json() as Promise<T>;
  }
  function owned(owner: string, id: string): void {
    if (id !== hostedAgentSessionId(owner)) throw Error('not_found');
  }
  const agent: HostedRemoteAgent = {
    owns: (owner, id) => id === hostedAgentSessionId(owner),
    async status(owner) {const session=await json<Awaited<ReturnType<NonNullable<HostedRemoteAgent['status']>>>>(owner,'/status',{});if(session)owned(owner,session.id);return session;},
    async ensure(owner) {
      const session = await json<Awaited<ReturnType<HostedRemoteAgent['ensure']>>>(owner, '/ensure', {});
      owned(owner, session.id);
      return session;
    },
    async view(owner, id, since) {
      owned(owner, id);
      const view = await json<Awaited<ReturnType<HostedRemoteAgent['view']>>>(owner, '/view', { id, since });
      owned(owner, view.session.id);
      return view;
    },
    async input(owner, id, text) { owned(owner, id); await json(owner, '/input', { id, text }); },
    async stop(owner, id) { owned(owner, id); await json(owner, '/stop', { id }); },
    async deliverComment(owner, comment) {
      owned(owner, comment.sessionId);
      if(!commentForward)throw Error('hosted_comment_transport_unavailable');
      const response=await request(owner, '/comment', comment, commentForward);
      if(!response.ok)throw Error('hosted_comment_delivery_failed');
    },
    authorizeOperation: (owner,tokenId,name,input,credential) => json(owner,'/authorize-operation',{tokenId,name,input,credential}),
    async operationCompleted(owner,tokenId,name,input,result,credential){await json(owner,'/operation-completed',{tokenId,name,input,result,credential});},
    operation: (owner, requestId, operation, args) => request(owner, '/operation', { requestId, operation, args }),
  };
  return agent;
}
