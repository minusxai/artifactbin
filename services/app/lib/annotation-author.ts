/**
 * Display attribution for an annotation reply. This is descriptive, never an
 * authorization signal: both MCP clientInfo and User-Agent are self-reported.
 */
import { ARTIFACTBIN_AGENT_HEADER, identifyClient, type Harness } from './client-identity';
import type { AnnotationAuthor } from './annotations';

const AGENT_LABELS: Partial<Record<Harness, string>> = {
  chatgpt: 'ChatGPT',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  'claude-web': 'Claude',
  cursor: 'Cursor',
  vscode: 'VS Code',
  cline: 'Cline',
  windsurf: 'Windsurf',
  zed: 'Zed',
};

export const agentLabelForHarness = (harness: Harness | null | undefined): string | null =>
  harness ? AGENT_LABELS[harness] ?? null : null;

/** An explicit header/branded UA wins; remembered identity fills runtime-only UAs such as `node`. */
export function annotationAuthorForRequest(request: Request, rememberedHarness?: Harness | null): AnnotationAuthor {
  const requestHarness = identifyClient({
    agentHeader: request.headers.get(ARTIFACTBIN_AGENT_HEADER),
    userAgent: request.headers.get('user-agent'),
  }).harness;
  return {
    kind: 'agent',
    label: agentLabelForHarness(requestHarness) ?? agentLabelForHarness(rememberedHarness),
    transport: 'http',
  };
}
