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
import { normalizeControlOptions } from '@/components/kit/controls';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { coerceScalarInput, queriesDependingOn, refName, REF_ATTRS, type Dataflow, type DataflowState, type Scalar, type ScalarValueDecl } from '@/lib/story/dataflow';
import type { ArtifactFileVariant } from './file-format';

export interface VariantCaps {
  /** Most query runs (combinations) the download may spend. */
  maxVariants: number;
  /** Most JSON bytes all variants together may add to the file. */
  maxBytes: number;
}

export const DEFAULT_VARIANT_CAPS: VariantCaps = { maxVariants: 200, maxBytes: 8 * 1024 * 1024 };

/** What one bound control can set its Value to: a finite list, or anything (null). */
type ControlDomain = { kind: 'options'; el: JsxElement } | { kind: 'boolean' } | { kind: 'open' };

/**
 * Scalar positions that only READ their reference (REF_ATTRS lists them beside
 * the writers): a person's id and a bound image source never set a Value.
 */
const READ_ONLY_POSITIONS: Record<string, ReadonlySet<string>> = {
  User: new Set(['userId']), UserImage: new Set(['userId']), UserHandle: new Set(['userId']), img: new Set(['src']),
};

const staticJson = (el: JsxElement, name: string): unknown => {
  const attr = el.attributes.find((a) => a.name === name || (!el.isComponent && a.name.toLowerCase() === name));
  return attr && attr.value.static ? attr.value.json : undefined;
};

/**
 * The Value a control WRITES and what it can write, from the REF_ATTRS scalar
 * positions.
 */
function controlBindings(el: JsxElement): Array<{ name: string; domain: ControlDomain }> {
  const table = el.isComponent ? REF_ATTRS.components[el.tag] : REF_ATTRS.html[el.tag.toLowerCase()];
  const tag = el.isComponent ? el.tag : el.tag.toLowerCase();
  const out: Array<{ name: string; domain: ControlDomain }> = [];
  for (const a of el.attributes) {
    if (!a.value.static) continue;
    const attr = el.isComponent ? a.name : a.name.toLowerCase();
    const expects = table?.[attr];
    if (expects !== 'scalar' || READ_ONLY_POSITIONS[tag]?.has(attr)) continue;
    const name = refName(a.value.json);
    if (!name) continue;
    const choosesFromOptions = attr === 'value' && (tag === 'Select' || tag === 'Segmented' || tag === 'select');
    const toggles = (tag === 'Switch' && attr === 'checked') || (tag === 'input' && attr === 'checked') || (tag === 'Dialog' && attr === 'open');
    out.push({ name, domain: choosesFromOptions ? { kind: 'options', el } : toggles ? { kind: 'boolean' } : { kind: 'open' } });
  }
  return out;
}

const scalarKey = (v: Scalar): string => JSON.stringify(v);
const dedupe = (xs: Scalar[]): Scalar[] => [...new Map(xs.map((x) => [scalarKey(x), x])).values()];

/** The finite values one control offers, in the Value's own type; null when it can write anything. */
function controlValues(domain: ControlDomain, decl: ScalarValueDecl, base: DataflowState): Scalar[] | null {
  if (domain.kind === 'open') return null;
  const nullable = decl.default === null;
  if (domain.kind === 'boolean') return nullable ? [true, false, null] : [true, false];
  const el = domain.el;
  // A multi-select writes a JSON list and allowCreate writes free text: no finite domain.
  if (staticJson(el, 'multiple') === true || staticJson(el, 'allowCreate') === true) return null;
  const raw = staticJson(el, 'options');
  const optionsName = refName(raw);
  const options = raw === undefined && decl.type === 'user'
    ? base.userOptions?.[decl.name] ?? []
    : normalizeControlOptions(raw, optionsName ? base.tables[optionsName] : undefined);
  const values = options.map((o) => coerceScalarInput(decl.type, o.value));
  // The runtime offers "All" (null) for a Value whose default is null; a placeholder names that choice.
  return dedupe(nullable || typeof staticJson(el, 'placeholder') === 'string' ? [null, ...values] : values);
}

/**
 * For every Value that at least one query reads (directly, or through a query
 * it references): the finite list of values its bound controls can set, in
 * the Value's own type — options from a literal list or a `$query` (resolved
 * against `base`), true/false for a Switch, plus null where the control can
 * clear ("All"). `null` for a Value no control makes finite (text, number,
 * date, slider inputs, or no control at all).
 */
export function valueDomains(nodes: JsxNode[], flow: Dataflow, base: DataflowState): Map<string, Scalar[] | null> {
  const scalars = new Map(flow.values.filter((v): v is ScalarValueDecl => v.kind === 'scalar').map((v) => [v.name, v]));
  const read = new Set(flow.queries.flatMap((q) => q.params).filter((p) => scalars.has(p)));
  const bound = new Map<string, ControlDomain[]>();
  const visit = (list: JsxNode[]) => {
    for (const n of list) {
      if (n.type !== 'element') continue;
      for (const { name, domain } of controlBindings(n)) if (read.has(name)) bound.set(name, [...(bound.get(name) ?? []), domain]);
      visit(n.children);
    }
  };
  visit(nodes);
  const out = new Map<string, Scalar[] | null>();
  for (const decl of scalars.values()) {
    if (!read.has(decl.name)) continue;
    const controls = bound.get(decl.name) ?? [];
    const each = controls.map((c) => controlValues(c, decl, base));
    out.set(decl.name, controls.length === 0 || each.some((v) => v === null) ? null : dedupe(each.flatMap((v) => v!)));
  }
  return out;
}

export interface PrecomputeInput {
  flow: Dataflow;
  base: DataflowState;
  domains: Map<string, Scalar[] | null>;
  /** Runs the named queries (dependency-closed) with these values, as the downloader. */
  run(values: Record<string, Scalar>, only: string[]): Promise<Pick<DataflowState, 'tables' | 'errors'>>;
  caps?: VariantCaps;
}

const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** Every combination of the domains, as the list of Values each one moves off its base value. */
function cartesian(names: string[], choices: Map<string, Scalar[]>): Array<Record<string, Scalar>> {
  let combos: Array<Record<string, Scalar>> = [{}];
  for (const name of names) combos = combos.flatMap((c) => choices.get(name)!.map((v) => ({ ...c, [name]: v })));
  return combos;
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
  const caps = input.caps ?? DEFAULT_VARIANT_CAPS;
  const baseValues: Record<string, Scalar> = {};
  for (const name of input.domains.keys()) baseValues[name] = input.base.values[name] ?? null;
  const frozen = [...input.domains].filter(([, d]) => d === null).map(([name]) => name);
  /*
   * Each finite domain WITH its base value, so a combination that keeps one
   * Value at a base the controls do not list (a default outside the options)
   * is still reachable offline.
   */
  const choices = new Map<string, Scalar[]>();
  for (const [name, domain] of input.domains) {
    if (domain === null) continue;
    const values = dedupe([baseValues[name], ...domain]);
    if (values.length > 1) choices.set(name, values);
  }
  let varied = [...choices.keys()];
  const product = (names: string[]) => names.reduce((n, name) => n * choices.get(name)!.length, 1) - 1;
  const oneAtATime = (names: string[]) => names.reduce((n, name) => n + choices.get(name)!.length - 1, 0);
  // Freeze the largest domains until one of the two plans fits the run budget.
  while (varied.length && product(varied) > caps.maxVariants && oneAtATime(varied) > caps.maxVariants) {
    const largest = varied.reduce((a, b) => (choices.get(b)!.length > choices.get(a)!.length ? b : a));
    varied = varied.filter((n) => n !== largest);
    frozen.push(largest);
  }
  const moves: Array<Record<string, Scalar>> = product(varied) <= caps.maxVariants
    ? cartesian(varied, choices)
    : varied.flatMap((name) => choices.get(name)!.map((v) => ({ [name]: v })));
  const plan = moves
    .map((move) => Object.fromEntries(Object.entries(move).filter(([name, v]) => scalarKey(v) !== scalarKey(baseValues[name]))))
    .filter((move) => Object.keys(move).length > 0);

  const kept: Array<{ move: Record<string, Scalar>; variant: ArtifactFileVariant }> = [];
  let spent = 0;
  let stoppedAt = plan.length;
  for (let i = 0; i < plan.length; i++) {
    const move = plan[i];
    const values = { ...input.base.values, ...baseValues, ...move };
    const only = queriesDependingOn(input.flow, Object.keys(move));
    const result = await input.run(values, only);
    const variant: ArtifactFileVariant = {
      values: { ...baseValues, ...move },
      tables: Object.fromEntries(only.filter((q) => result.tables[q]).map((q) => [q, result.tables[q]])),
      errors: Object.fromEntries(only.filter((q) => result.errors[q] !== undefined).map((q) => [q, result.errors[q]])),
    };
    const bytes = byteLength(variant);
    if (spent + bytes > caps.maxBytes) { stoppedAt = i; break; }
    spent += bytes;
    kept.push({ move, variant });
  }
  /*
   * Past the byte budget: every Value some dropped combination moves is
   * frozen, and a kept variant that moves a frozen Value is unreachable (its
   * control is disabled) so it goes too. What survives is still a complete
   * plan over the Values left enabled.
   */
  const overBudget = new Set(plan.slice(stoppedAt).flatMap((move) => Object.keys(move)));
  for (const name of varied) if (overBudget.has(name)) frozen.push(name);
  return {
    variants: kept.filter(({ move }) => !Object.keys(move).some((name) => overBudget.has(name))).map(({ variant }) => variant),
    frozen,
  };
}
