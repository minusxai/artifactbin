/**
 * The ONE leg a run drives, described entirely on the command line.
 *
 * This repo deliberately knows nothing about which harnesses and models are
 * being compared, what the roster is, or what a set of them is called. That is a
 * deployment concern: the workflow decides which runs to do and what to call
 * them, and `eval:report` merges N run directories without knowing why there are
 * N. minusx draws the line in exactly the same place — the word "leg" appears
 * only in its deploys workflow, never in the app repo.
 */
import { HARNESSES, type Harness, type Price } from './contracts';
import type { Args } from './args';
import { planMode, type ModePlan } from './mode';

export interface Leg {
  harness: Harness;
  /** In the harness's own notation. */
  model: string;
  /** NAME of the environment variable holding the key — never the key. */
  envVar: string;
  apiKey: string;
  /** The report column's name. */
  label: string;
  /** The fallback for a harness reporting no cost. Null when the caller gave no rates: unknown then, never zero. */
  price: Price | null;
  /** False for a text-only model — the prompt then says not to fetch the rendered PNG. */
  vision: boolean;
  /**
   * How this leg reaches the product, and whether that is what was asked for:
   * a harness that cannot do the asked mode runs the nearest thing it can and
   * the report says so (`lib/mode.ts`).
   */
  mode: ModePlan;
}

export function legFromArgs(args: Args, env: Record<string, string | undefined>): Leg {
  if (!args.harness) throw new Error('--harness is required (one of: ' + HARNESSES.join(', ') + ')');
  if (!HARNESSES.includes(args.harness as Harness)) {
    throw new Error(`unknown harness "${args.harness}" — known: ${HARNESSES.join(', ')}`);
  }
  if (!args.model) throw new Error('--model is required — the model id in the harness\'s own notation');
  if (!args.envVar) throw new Error('--api-key-env is required — the NAME of the variable holding the provider key');

  const apiKey = env[args.envVar];
  if (!apiKey) throw new Error(`${args.envVar} is not set — put it in .env locally, or in the workflow secrets`);

  const price: Price | null = args.priceIn !== undefined && args.priceOut !== undefined
    ? {
        in: args.priceIn,
        out: args.priceOut,
        ...(args.priceCacheRead !== undefined ? { cacheRead: args.priceCacheRead } : {}),
        ...(args.priceCacheWrite !== undefined ? { cacheWrite: args.priceCacheWrite } : {}),
        ...(args.priceWebSearch !== undefined ? { webSearchCall: args.priceWebSearch } : {}),
      }
    : null;

  return {
    harness: args.harness as Harness,
    model: args.model,
    envVar: args.envVar,
    apiKey,
    label: args.label ?? args.harness,
    price,
    vision: args.vision,
    mode: planMode(args.harness as Harness, args.mode),
  };
}
