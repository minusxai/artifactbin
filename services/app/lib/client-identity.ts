/**
 * WHICH agent is talking to us — one module, every caller.
 *
 * Three channels, and they are not equal:
 *
 *  - MCP `initialize` carries `params.clientInfo: {name, version}`. This is the
 *    protocol's own answer, every spec-compliant client sends it, and it is the
 *    only channel that names an agent rather than a runtime.
 *  - The User-Agent header, which is all a plain HTTP caller (an agent fetching
 *    /docs, or hitting the REST API) gives us by default.
 *  - Raw HTTP agents can explicitly send `Artifactbin-Agent`. Unlike a runtime
 *    UA it answers which harness is making the call, so it wins when recognized.
 *
 * The difference is not academic. Measured against real traffic, OpenAI's
 * harnesses brand their UA (`openai-mcp`, `codex-mcp-client`) while Node-based
 * clients — Claude Code among them — send bare `node`, which is the default UA
 * for Node's fetch and identifies a RUNTIME, not an agent. So UA alone cannot
 * tell Claude Code from any other Node script; an explicit agent header or
 * MCP clientInfo can, and does. Those naming channels win over a runtime UA.
 *
 * Deliberately non-authenticating: all three channels are self-reported and
 * trivially forged. Nothing may gate access on them.
 */

export type Harness =
  | 'chatgpt'
  | 'codex'
  | 'claude-code'
  | 'claude-web'
  | 'cursor'
  | 'vscode'
  | 'cline'
  | 'windsurf'
  | 'zed'
  | 'curl'
  | 'browser'
  | 'script'
  | 'unknown';

export interface ClientIdentity {
  /** Best guess at the harness. 'unknown' when nothing matched. */
  harness: Harness;
  /** The raw name we matched on, for logs — declaration, clientInfo.name, or UA. */
  label: string;
  version: string | null;
  /** Which channel decided it. All are descriptive and self-reported, never authorization. */
  source: 'agent-header' | 'clientInfo' | 'user-agent' | 'none';
}

export interface ClientInfo {
  name?: unknown;
  version?: unknown;
}

/**
 * MCP client names, matched against `clientInfo.name` (lowercased, substring).
 * Order matters: the first match wins, so put specific before generic.
 */
const CLIENT_INFO_HARNESSES: ReadonlyArray<readonly [pattern: string, harness: Harness]> = [
  ['claude-code', 'claude-code'],
  ['claude code', 'claude-code'],
  ['claude-ai', 'claude-web'],
  ['claude.ai', 'claude-web'],
  ['chatgpt', 'chatgpt'],
  ['openai-mcp', 'chatgpt'],
  ['codex', 'codex'],
  ['cursor', 'cursor'],
  ['windsurf', 'windsurf'],
  ['cline', 'cline'],
  ['zed', 'zed'],
  ['visual studio code', 'vscode'],
  ['vscode', 'vscode'],
];

/** User-Agent patterns. Only brands that actually identify themselves land here. */
const USER_AGENT_HARNESSES: ReadonlyArray<readonly [pattern: string, harness: Harness]> = [
  ['openai-mcp', 'chatgpt'],
  ['chatgpt', 'chatgpt'],
  ['codex-mcp-client', 'codex'],
  ['codex', 'codex'],
  ['claude-code', 'claude-code'],
  ['claude-user', 'claude-web'],
  ['anthropic', 'claude-web'],
  ['cursor', 'cursor'],
  ['windsurf', 'windsurf'],
  ['cline', 'cline'],
  ['curl/', 'curl'],
  ['mozilla/', 'browser'],
  // `node`, `python-httpx`, `aiohttp`, `python-urllib` … are RUNTIMES. They say
  // nothing about the agent, so they collapse to one honest bucket rather than
  // being guessed at.
  ['node', 'script'],
  ['python', 'script'],
  ['aiohttp', 'script'],
  ['okhttp', 'script'],
  ['go-http-client', 'script'],
  ['axios', 'script'],
  ['undici', 'script'],
];

/** Exact values accepted from Artifactbin-Agent. No substring matching: it is an explicit declaration. */
const DECLARED_AGENT_HARNESSES: Readonly<Record<string, Harness>> = {
  chatgpt: 'chatgpt',
  codex: 'codex',
  'claude-code': 'claude-code',
  claude: 'claude-web',
  'claude-web': 'claude-web',
  cursor: 'cursor',
  vscode: 'vscode',
  cline: 'cline',
  windsurf: 'windsurf',
  zed: 'zed',
};

const matchIn = (
  haystack: string,
  table: ReadonlyArray<readonly [string, Harness]>,
): Harness | null => table.find(([pattern]) => haystack.includes(pattern))?.[1] ?? null;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Identify the caller. An explicit supported declaration wins, then
 * `clientInfo`, then UA. A runtime UA cannot distinguish agents sharing it.
 */
export const ARTIFACTBIN_AGENT_HEADER = 'Artifactbin-Agent';

/** A supported explicit HTTP declaration, or null when the value is absent/unknown. */
export function declaredAgentHarness(value: unknown): Harness | null {
  const declared = str(value);
  if (!declared) return null;
  const key = declared.toLowerCase().replace(/[\s_]+/g, '-');
  return DECLARED_AGENT_HARNESSES[key] ?? null;
}

export function identifyClient(input: {
  agentHeader?: string | null;
  userAgent?: string | null;
  clientInfo?: ClientInfo | null;
}): ClientIdentity {
  const declared = str(input.agentHeader);
  const declaredHarness = declaredAgentHarness(declared);
  const name = str(input.clientInfo?.name);
  const version = str(input.clientInfo?.version);
  const ua = str(input.userAgent);

  if (declared && declaredHarness) {
    return { harness: declaredHarness, label: declared, version: null, source: 'agent-header' };
  }
  if (name) {
    const harness = matchIn(name.toLowerCase(), CLIENT_INFO_HARNESSES);
    // Even unmatched, a clientInfo name beats a UA: the client named ITSELF.
    return { harness: harness ?? 'unknown', label: name, version, source: 'clientInfo' };
  }
  if (ua) {
    return { harness: matchIn(ua.toLowerCase(), USER_AGENT_HARNESSES) ?? 'unknown', label: ua, version: null, source: 'user-agent' };
  }
  return { harness: 'unknown', label: '(none)', version: null, source: 'none' };
}

/** One-line form for logs. */
export function describeClient(id: ClientIdentity): string {
  return `${id.harness} (${id.label}${id.version ? ` ${id.version}` : ''}, via ${id.source})`;
}

/** Emit the identity of a caller. Telemetry only — never gate on this. */
export function logClientIdentity(context: string, input: {
  agentHeader?: string | null;
  userAgent?: string | null;
  clientInfo?: ClientInfo | null;
}): ClientIdentity {
  const id = identifyClient(input);
  console.log(`[client] ${context}: ${describeClient(id)}`);
  return id;
}

/**
 * WHERE the caller is, as the nearest trusted proxy saw them.
 *
 * `X-Forwarded-For` is a list each hop APPENDS to, so it reads `<whatever the
 * client sent>, <what proxy1 saw>, <what proxy2 saw>, …`: the address our
 * outermost trusted proxy observed sits `hops` from the END, and everything to
 * the left of it is text the caller typed. The index is clamped at the front so
 * a SHORT list cannot walk the selection back onto a caller-supplied entry.
 *
 * Unlike the User-Agent above this is used for a rate-limit BUCKET as well as
 * telemetry, so which end is read is a security property, not a preference —
 * see lib/auth.ts `clientIp`. `x-real-ip` is the single-value spelling some
 * proxies send instead; empty string means the caller is unidentifiable.
 */
export function forwardedFor(
  headers: { get(name: string): string | null },
  hops: number,
): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (chain.length > 0) return chain[Math.max(0, chain.length - hops)];
  }
  return headers.get('x-real-ip')?.trim() || '';
}
