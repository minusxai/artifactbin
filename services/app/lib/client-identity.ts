/** HTTP display attribution from an explicit harness header or User-Agent. Never authorization. */

import { AGENT_HEADER, declaredAgentSlug, type DeclaredAgentSlug } from '@artifactbin/contracts';

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
  /** The raw name we matched on, for logs — declaration or UA. */
  label: string;
  version: string | null;
  /** Which channel decided it. All are descriptive and self-reported, never authorization. */
  source: 'agent-header' | 'user-agent' | 'none';
}

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

/**
 * Which declaration maps to which harness. The KEYS are `DECLARED_AGENT_SLUGS` from contracts — the ONE
 * allowlist, which the proxy reads too (it tags `/tokens/new?source=<agent>` at a refused mint door).
 * Typed as a total record over that union, so a slug added there without a mapping here fails to compile.
 */
const DECLARED_AGENT_HARNESSES: Readonly<Record<DeclaredAgentSlug, Harness>> = {
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
 * UA. A runtime UA cannot distinguish agents sharing it.
 */
/** The header's name, re-exported under this module's older name — contracts spells it once. */
export const ARTIFACTBIN_AGENT_HEADER = AGENT_HEADER;

/** A supported explicit HTTP declaration, or null when the value is absent/unknown. */
export function declaredAgentHarness(value: unknown): Harness | null {
  const declared = str(value);
  if (!declared) return null;
  const slug = declaredAgentSlug(declared);
  return slug ? DECLARED_AGENT_HARNESSES[slug] : null;
}

export function identifyClient(input: {
  agentHeader?: string | null;
  userAgent?: string | null;
}): ClientIdentity {
  const declared = str(input.agentHeader);
  const declaredHarness = declaredAgentHarness(declared);
  const ua = str(input.userAgent);

  if (declared && declaredHarness) {
    return { harness: declaredHarness, label: declared, version: null, source: 'agent-header' };
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
