/**
 * Display attribution for an annotation reply. This is descriptive, never an
 * authorization signal: both the agent header and the User-Agent are
 * self-reported.
 */
import { ARTIFACTBIN_AGENT_HEADER, identifyClient, type Harness } from '../platform/client-identity';
import type { AnnotationAuthor } from '@artifactbin/contracts';

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

const agentLabelForHarness = (harness: Harness | null | undefined): string | null =>
  harness ? AGENT_LABELS[harness] ?? null : null;

/** An explicit header/branded UA wins; remembered identity fills runtime-only UAs such as `node`. */
export function annotationAuthorForRequest(request: Request, rememberedHarness?: Harness | null): AnnotationAuthor {
  const declared = request.headers.get(ARTIFACTBIN_AGENT_HEADER)?.trim();
  if (declared) return annotationAuthorForAgent(declared);
  const requestHarness = identifyClient({
    userAgent: request.headers.get('user-agent'),
  }).harness;
  return {
    kind: 'agent',
    label: agentLabelForHarness(requestHarness) ?? agentLabelForHarness(rememberedHarness),
    transport: 'http',
  };
}

/** Explicit display identity; custom agent names are valid and never grant access. */
export function annotationAuthorForAgent(name: string): AnnotationAuthor {
  const harness = identifyClient({agentHeader: name}).harness;
  return {kind: 'agent', label: agentLabelForHarness(harness) ?? (name.trim() || null), transport: 'http'};
}
