/**
 * The cost column.
 *
 * The harness's own figure comes FIRST. Each harness runs the provider it is
 * native to and prices its run at that provider's rates, cache discounts
 * included — measured on a production run, Claude Code's figure matched a
 * hand-priced one to 0.1% and Pi's matched LiteLLM's table to the cent, while
 * the hand-typed roster rates were wrong by 2–3× on the Fireworks legs. It was
 * distrusted as "list price" once; list price IS the bill.
 *
 * Tokens × the leg's rates is the fallback for a harness that reports no cost —
 * Codex emits token counts only (its CLI has no cost output; openai/codex#18600)
 * — plus a flat per-call fee for each provider-side web search, which no usage
 * object carries and which nearly doubled one Codex run. Cache reads and writes
 * take the leg's rates, defaulting to the input rate.
 */
import type { HarnessResult, Price, TokenUsage } from './contracts';

export type CostSource = 'harness' | 'priced';

/** `usd: null` is UNKNOWN — a run with neither a figure nor rates must never read as free. */
export interface TaskCost {
  usd: number | null;
  source: CostSource | null;
}

export function taskCost(result: Pick<HarnessResult, 'reportedCostUsd' | 'tokens' | 'webSearchCalls'>, price: Price | null): TaskCost {
  if (result.reportedCostUsd !== null) return { usd: Math.round(result.reportedCostUsd * 1e6) / 1e6, source: 'harness' };
  if (!price) return { usd: null, source: null };
  const tokens = costUsd(result.tokens, price);
  if (tokens === null) return { usd: null, source: null };
  const searches = (result.webSearchCalls ?? 0) * (price.webSearchCall ?? 0);
  return { usd: Math.round((tokens + searches) * 1e6) / 1e6, source: 'priced' };
}

export function costUsd(tokens: TokenUsage | null, price: Price): number | null {
  if (!tokens) return null;
  const cacheRead = price.cacheRead ?? price.in;
  const cacheWrite = price.cacheWrite ?? price.in;
  const usd = (tokens.input / 1e6) * price.in + (tokens.cacheRead / 1e6) * cacheRead + (tokens.cacheWrite / 1e6) * cacheWrite + (tokens.output / 1e6) * price.out;
  return Math.round(usd * 1e6) / 1e6;
}
