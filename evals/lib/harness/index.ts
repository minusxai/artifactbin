/** The four adapters, by harness name. Each is `{ prepare, invocation, reduce }` over the shared contracts. */
import type { Harness, HarnessAdapter } from '../contracts';
import { claudeCode } from './claude-code';
import { codex } from './codex';
import { pi } from './pi';
import { opencode } from './opencode';

const ADAPTERS: Record<Harness, HarnessAdapter> = { 'claude-code': claudeCode, codex, pi, opencode };

export function adapterFor(harness: Harness): HarnessAdapter {
  return ADAPTERS[harness];
}
