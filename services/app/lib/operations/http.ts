/**
 * The HTTP half of the operations registry: a bearer route is a TRANSLATION
 * LAYER — it gathers the input (JSON body + path params + the odd query
 * flag), builds the transport context, and maps the operation's reply back
 * to a Response. No route holds protocol semantics of its own; those live in
 * the operation's `run` (which is itself the shared lib/artifact-wire
 * pipeline both transports call).
 */
import { json, baseUrl } from '@/lib/http';
import type { TokenActor } from '@/lib/artifacts';
import type { AnnotationAuthor } from '@/lib/annotations';
import { OPERATIONS, type OpContext, type Operation, type OpReply } from './registry';

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
  const ctx: OpContext = { actor, base: baseUrl(request), request, author };
  return opResponse(await operation(name).run(ctx, input));
}
