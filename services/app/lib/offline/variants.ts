/**
 * PRECOMPUTED FILTERS — how an offline file keeps its filters working with no
 * SQL engine inside it.
 *
 * At download the server finds every `<Value>` that some query reads, works out
 * the finite set of values its bound controls can produce, runs the affected
 * queries once per combination with its own engine, and stores the results as
 * snapshot variants. A Value with no finite domain (free text, numbers, dates,
 * sliders) or one that would push past the caps is FROZEN: its control is
 * disabled offline with a reason.
 *
 * Pure apart from the injected `run`, so the policy is testable without a
 * database; lib/offline/download.server.ts wires `run` to dataflowForRow as
 * the downloader.
 */
import type { JsxNode } from '@/lib/jsx';
import type { Dataflow, DataflowState, Scalar } from '@/lib/story/dataflow';
import type { ArtifactFileVariant } from './file-format';

export interface VariantCaps {
  /** Most query runs (combinations) the download may spend. */
  maxVariants: number;
  /** Most JSON bytes all variants together may add to the file. */
  maxBytes: number;
}

export const DEFAULT_VARIANT_CAPS: VariantCaps = { maxVariants: 200, maxBytes: 8 * 1024 * 1024 };

/**
 * For every Value that at least one query reads (directly, or through a query
 * it references): the finite list of values its bound controls can set, in
 * the Value's own type — options from a literal list or a `$query` (resolved
 * against `base`), true/false for a Switch, plus null where the control can
 * clear ("All"). `null` for a Value no control makes finite (text, number,
 * date, slider inputs, or no control at all).
 */
export function valueDomains(nodes: JsxNode[], flow: Dataflow, base: DataflowState): Map<string, Scalar[] | null> {
  void nodes; void flow; void base;
  throw new Error('not implemented: valueDomains');
}

export interface PrecomputeInput {
  flow: Dataflow;
  base: DataflowState;
  domains: Map<string, Scalar[] | null>;
  /** Runs the named queries (dependency-closed) with these values, as the downloader. */
  run(values: Record<string, Scalar>, only: string[]): Promise<Pick<DataflowState, 'tables' | 'errors'>>;
  caps?: VariantCaps;
}

/**
 * Chooses combinations and runs them. Prefers the full cartesian product of
 * the finite domains; if that exceeds `maxVariants`, varies one Value at a time
 * from the base values; if that still exceeds it, freezes the Values with the
 * largest domains until it fits. Stops adding variants at `maxBytes` and
 * freezes what is left. Each variant stores only the queries its values
 * change. Never includes the base combination itself.
 */
export async function precomputeVariants(input: PrecomputeInput): Promise<{ variants: ArtifactFileVariant[]; frozen: string[] }> {
  void input;
  throw new Error('not implemented: precomputeVariants');
}
