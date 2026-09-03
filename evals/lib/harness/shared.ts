/** Helpers every adapter uses. Separate from the registry so an adapter never imports the module that imports it. */
import type { HarnessResult } from '../contracts';
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

/** The shape of a run that told us nothing: every count null, no tool record. Typed (not `as const`) so `invocations` stays a mutable `ToolInvocation[]`. */
export const NO_TELEMETRY: Pick<HarnessResult, 'turns' | 'toolCalls' | 'docsReadCalls' | 'invocations' | 'tokens' | 'reportedCostUsd' | 'webSearchCalls'> =
  { turns: null, toolCalls: null, docsReadCalls: null, invocations: [], tokens: null, reportedCostUsd: null, webSearchCalls: null };
