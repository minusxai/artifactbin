/**
 * Display attribution for an annotation reply. This is descriptive, never an
 * authorization signal: the agent header, its session header and the
 * User-Agent are all self-reported.
 */
import { ARTIFACTBIN_AGENT_HEADER, identifyClient, type Harness } from '../accounts';
import { AGENT_SESSION_HEADER, agentSessionKey, declaredAgentSlug, type AnnotationAuthor } from '@artifactbin/contracts';

const AGENT_LABELS: Partial<Record<Harness, string>> = {
  chatgpt: 'ChatGPT',
  codex: 'Codex',
  pi: 'Pi',
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  'claude-web': 'Claude',
  cursor: 'Cursor',
  vscode: 'VS Code',
  cline: 'Cline',
  windsurf: 'Windsurf',
  zed: 'Zed',
};

/** The longest name an agent may show: room for "<product> <colour>" and a person's own choice. */
const AGENT_NAME_MAX = 64;

const agentLabelForHarness = (harness: Harness | null | undefined): string | null =>
  harness ? AGENT_LABELS[harness] ?? null : null;

/** An explicit header/branded UA wins; remembered identity fills runtime-only UAs such as `node`. */
export function annotationAuthorForRequest(request: Request, rememberedHarness?: Harness | null): AnnotationAuthor {
  const session = agentSessionKey(request.headers.get(AGENT_SESSION_HEADER));
  const writer = session ? { writerSession: session } : {};
  const declared = agentName(request.headers.get(ARTIFACTBIN_AGENT_HEADER));
  if (declared) return { ...annotationAuthorForAgent(declared), ...writer };
  const requestHarness = identifyClient({
    userAgent: request.headers.get('user-agent'),
  }).harness;
  return {
    kind: 'agent',
    label: agentLabelForHarness(requestHarness) ?? agentLabelForHarness(rememberedHarness),
    transport: 'http',
    ...writer,
  };
}

/** A declared name as it may be shown: printable characters only, whitespace collapsed, at most AGENT_NAME_MAX. */
function agentName(value: string | null): string | null {
  const name = (value ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return name ? [...name].slice(0, AGENT_NAME_MAX).join('').trim() : null;
}

/** Explicit display identity, kept whole ("Claude Code Red"); a bare product slug ("claude-code") reads as the
 * product's name. Custom agent names are valid and never grant access. */
function annotationAuthorForAgent(name: string): AnnotationAuthor {
  const slug = declaredAgentSlug(name);
  const harness = slug ? identifyClient({agentHeader: slug}).harness : null;
  return {kind: 'agent', label: agentLabelForHarness(harness) ?? name, transport: 'http'};
}
