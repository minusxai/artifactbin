/** Helpers every adapter uses. Separate from the registry so an adapter never imports the module that imports it. */
export function parseJsonl(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      // torn line
    }
  }
  return out;
}

export const NO_TELEMETRY = { turns: null, toolCalls: null, docsReadCalls: null, tokens: null, reportedCostUsd: null, webSearchCalls: null } as const;
