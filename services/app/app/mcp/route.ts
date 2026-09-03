/**
 * The MCP server — the agent front door, a thin protocol adapter over the
 * OPERATIONS REGISTRY (`lib/operations`): every tool is one registered
 * operation, so the tool surface, the HTTP routes and the docs' endpoint
 * reference cannot drift apart. Streamable HTTP at /mcp; auth is the same
 * bearer Token as the API (paste it into the MCP client config;
 * anonymous-mint one via POST /api/tokens/anonymous).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type TokenActor } from '@/lib/artifacts';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { type AnnotationAuthor } from '@/lib/annotations';
import { logClientIdentity, type ClientIdentity, type Harness } from '@/lib/client-identity';
import { PUBLIC_BASE_URL } from '@/lib/config';
import { buildMcpInstructions } from '@/lib/skills';
import { baseUrl, unauthorized } from '@/lib/http';
import { wwwAuthenticate } from '@artifactbin/utils';
import { rememberTokenClient, resolveToken, resolveTokenById } from '@/lib/tokens';
import { agentLabelForHarness } from '@/lib/annotation-author';
import { sessionActor } from '@/lib/viewer';

const err = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  isError: true,
});
const ok = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
});

/** The bearer actor the transport resolved (see extra.authInfo below). */
const actorFrom = (extra: unknown): TokenActor => {
  const info = (extra as { authInfo?: { extra?: { tokenId?: string; userId?: string | null } } }).authInfo?.extra ?? {};
  return { tokenId: (info.tokenId ?? '') as string, userId: (info.userId ?? null) as string | null };
};

const BASE = PUBLIC_BASE_URL;

/**
 * `request` is threaded in for ONE reason: the preview flag (lib/features) is
 * resolved per request, and the write-ACL field must be admitted here on
 * exactly the terms the HTTP door admits it — otherwise the two surfaces
 * disagree about what is allowed, which is the drift the shared registry
 * exists to prevent.
 */
function buildServer(request: Request, author: AnnotationAuthor): McpServer {
  const server = new McpServer({ name: 'artifactbin', version: '0.1.0' }, { instructions: buildMcpInstructions(BASE) });
  for (const op of OPERATIONS) {
    server.registerTool(
      op.name,
      {
        title: op.title,
        description: op.description,
        inputSchema: op.input,
        annotations: {
          ...(op.annotations.readOnly !== undefined ? { readOnlyHint: op.annotations.readOnly } : {}),
          ...(op.annotations.destructive !== undefined ? { destructiveHint: op.annotations.destructive } : {}),
          ...(op.annotations.idempotent !== undefined ? { idempotentHint: op.annotations.idempotent } : {}),
        },
      },
      async (args: Record<string, unknown>, extra: unknown) => {
        const ctx: OpContext = { actor: actorFrom(extra), base: BASE, request, author };
        const reply = await op.run(ctx, args as Record<string, unknown>);
        if (reply.status >= 400) return err(reply.body);
        // An image reply (export_artifact) is a NATIVE image content block —
        // the whole point of the tool: an MCP-authed agent holds no bearer to
        // fetch the export URL of a private document with.
        if (reply.image) return { content: [{ type: 'image' as const, data: reply.image.base64, mimeType: reply.image.mimeType }] };
        return ok(reply.body);
      },
    );
  }
  return server;
}

/**
 * Stateless streamable HTTP: one server + transport per request (the PGLite
 * repo is single-process; sessions add nothing here). Auth is the same bearer
 * Token as the REST API; authInfo carries the token scope into every tool.
 */
/**
 * Log WHO is calling, from MCP's own handshake. Read off a CLONE so the body
 * stays unconsumed for the transport. Only `initialize` carries clientInfo —
 * the one message where a client names itself rather than its runtime.
 */
async function noteClient(req: Request): Promise<ClientIdentity | null> {
  try {
    const body = await req.clone().json();
    const message = Array.isArray(body) ? body[0] : body;
    if (message?.method !== 'initialize') return null;
    return logClientIdentity('mcp:initialize', {
      userAgent: req.headers.get('user-agent'),
      clientInfo: message?.params?.clientInfo,
    });
  } catch {
    // GET/DELETE, or a body that is not JSON — nothing to identify from.
    return null;
  }
}

async function handler(req: Request): Promise<Response> {
  const observed = await noteClient(req);
  const auth = req.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  /*
   * WHO IS ASKING comes from the ACTOR HEADER, like everywhere else in the app.
   * This route used to resolve the bearer token itself: the PROXY is the one
   * that holds the credential and resolves it, so a caller with a perfectly
   * good token was told `unauthorized` while every other authenticated route
   * worked — the one place still doing its own authentication was the one place
   * that broke. (The `tokens` table itself is the APP's: `grants.sql` gives the
   * proxy only `SELECT ON app.tokens`. What the app must not do is
   * AUTHENTICATE; reading its own row for a byline is fine, and is what
   * `resolveTokenById` below does.)
   *
   * `resolveToken` remains the fallback for a process with no proxy in front
   * (a direct handler call in a test), where there is no header to read.
   */
  const actor = await sessionActor(req);
  const fromHeader = actor.credential === 'bearer' && actor.tokenId
    ? { id: actor.tokenId, userId: actor.viewer?.userId ?? null, clientHarness: null as Harness | null }
    : null;
  const resolved = fromHeader ?? (actor.credential === 'none' && !actor.tokenId && presented ? await resolveToken(presented) : null);
  if (!resolved) {
    // WWW-Authenticate starts the OAuth discovery dance — the header and the
    // metadata path it names comes from the shared service utilities; an
    // OAuth-capable client follows it to the metadata and pops the browser.
    const response = unauthorized(req);
    response.headers.set('WWW-Authenticate', wwwAuthenticate(baseUrl(req)));
    return response;
  }
  if (observed?.source === 'clientInfo' && agentLabelForHarness(observed.harness)) {
    // Which agent holds this token is remembered on the app's own `tokens` row.
    // The label is an annotation's byline, not an authorization input, so a
    // refusal here must not fail the call — the request already carries the
    // harness it just told us about.
    await rememberTokenClient(resolved.id, observed.harness).catch(() => {});
  }
  /*
   * THE BYLINE IS READ BACK, because MCP names its client on `initialize` and
   * NEVER on the stateless `tools/call` that carries the actual reply. The
   * proxy-attached actor is identity-only — it has no room for a harness — so
   * that branch used to hand the author a hardcoded null and every MCP comment
   * from a proxied stack (production, and `npm run dev`) rendered as 'Agent'.
   *
   * This is a BYLINE lookup for an actor the proxy ALREADY vouched for, keyed
   * by the token id it vouched with — not a second authentication: the
   * `unauthorized` decision above still comes solely from the attached actor.
   * Widening the `Actor` contract to carry the harness is the tidier shape and
   * is deliberately out of scope here: it is an identity contract shared by
   * three services, and a display string does not belong in it.
   */
  const remembered = observed?.harness
    ? null
    : resolved.clientHarness ?? (await resolveTokenById(resolved.id))?.clientHarness ?? null;
  const author: AnnotationAuthor = {
    kind: 'agent',
    label: agentLabelForHarness(observed?.harness) ?? agentLabelForHarness(remembered),
    transport: 'mcp',
  };
  const server = buildServer(req, author);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req, {
    authInfo: {
      token: presented,
      scopes: ['artifacts'],
      clientId: resolved.id,
      extra: { tokenId: resolved.id, userId: resolved.userId ?? null },
    },
  });
}

export { handler as GET, handler as POST, handler as DELETE };
