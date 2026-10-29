/**
 * A DOCUMENT'S COMPILED TAILWIND AS SHARED SHEETS PLUS WHAT IT ADDS.
 *
 * Every document's stored `compiledCss` is the compile of the recipe union (kit and embed classes, the typography
 * palette — lib/story-design/story-css.server STORY_RECIPE_UNION) plus the few utilities the document itself names,
 * followed by every theme's token blocks. Measured: a small page's 130 KB sheet differs from the union's alone by
 * a few hundred bytes. The union is the same bytes for every document of a build, so it is served as immutable,
 * content-addressed stylesheets (lib/page-styles/linked-sheets.server) and the document carries only the
 * difference, inline.
 *
 * THE CASCADE IS PRESERVED, not approximated. Tailwind sorts its output, every utility is `!important`, and a
 * document's sheet is the union's rules with the document's own rules inserted at their sorted places. A rule moves
 * past another only where both can set one property of one element, and then the later one wins:
 * `px-5` stands before `@2xl:px-12` so the breakpoint wins, `py-14` before `pt-6` so the side wins.
 * So the union is cut into SHARDS, and for every rule the document adds:
 *
 *  - when nothing after it can disagree about order (`orderMatters`), it moves to the end, inline — the common case:
 *    the document's arbitrary values and off-scale numbers;
 *  - otherwise it stays where Tailwind put it, and the shard it sits inside is carried inline, whole and in order,
 *    instead of linked; a rule between two shards is carried inline between their links.
 *
 * What is not provable stays whole: `splitStoryCss` answers null and the document carries its sheet inline as
 * before. Two rules of one variant that set one property are a contradiction (the kit merges its own recipe classes
 * with an author's through twMerge, so they never meet); they are not considered.
 */
import { cssUnits, declaredProperties, declaredValues, orderMatters, variantOf } from './css-units';

/** The union's compile cut into shards, read once per build: what is shared, and the reference every document is compared with. */
export interface StoryCssBase {
  /** The shared sheets of rules, in order. */
  shards: readonly string[];
  /** Every theme's token blocks, appended last to every compile. */
  themes: string;
  /** @internal */
  order: readonly string[];
  /** @internal Which shard each of the union's rules is in. */
  shardOf: ReadonlyMap<string, number>;
}

/** One piece of a document's sheet, in the order it applies: a shared shard, or CSS carried inline. */
export type StorySegment = { shard: number } | { inline: string };

/** How many shards the union is cut into: few enough to be few requests, many enough that an inline shard is small. */
export const STORY_CSS_SHARDS = 8;

const join = (units: readonly string[]): string => units.join('\n');
const sizeOf = (units: readonly string[]): number => units.reduce((sum, unit) => sum + unit.length + 1, 0);

/** The compiled sheet without the theme blocks every compile ends with, or null when it does not end with them. */
function bodyOf(css: string, themes: string): string | null {
  const tail = `\n${themes}`;
  return css.endsWith(tail) ? css.slice(0, css.length - tail.length) : null;
}

/** The base of a build from the union's compile (`unionCss`, themes included) and the theme blocks it ends with. */
export function storyCssBase(unionCss: string, themes: string, count = STORY_CSS_SHARDS): StoryCssBase | null {
  const body = bodyOf(unionCss, themes);
  if (body === null) return null;
  const order = cssUnits(body);
  const target = sizeOf(order) / count;
  const shards: string[] = [];
  const shardOf = new Map<string, number>();
  let current: string[] = [];
  for (const unit of order) {
    // Cut where the running shard has reached its share, never inside a rule.
    if (current.length && sizeOf(current) >= target && shards.length < count - 1) { shards.push(join(current)); current = []; }
    shardOf.set(unit, shards.length);
    current.push(unit);
  }
  if (current.length) shards.push(join(current));
  return { shards, themes, order, shardOf };
}

const prelude = (unit: string): string => unit.slice(0, Math.max(0, unit.indexOf('{'))).trim();

/**
 * `full` (a document's stored compile) as the pieces it applies in order, or null when it is not the union's
 * compile with rules added (a different environment, an unexpected shape).
 */
export function splitStoryCss(full: string, base: StoryCssBase): StorySegment[] | null {
  const body = bodyOf(full, base.themes);
  if (body === null) return null;
  const units = cssUnits(body);

  // The union's rules must all stand in the document's sheet in the union's order; the only ones allowed to be
  // missing are those the document restates with more declarations (the theme-variable block grows with every
  // variable a utility reads, the `--tw-*` fallbacks with every property it sets).
  const extra = units.filter((unit) => !base.shardOf.has(unit));
  const found = units.filter((unit) => base.shardOf.has(unit));
  let next = 0;
  for (const unit of found) {
    while (next < base.order.length && base.order[next] !== unit) next++;
    if (next === base.order.length) return null;
    next++;
  }
  const present = new Set(found);
  for (const unit of base.order) {
    if (present.has(unit)) continue;
    const restated = extra.find((candidate) => prelude(candidate) === prelude(unit));
    if (!restated) return null;
    // The restatement must say the same as the union's statement and then more: the union's own stays in its shard.
    const declared = declaredValues(restated);
    for (const [property, value] of declaredValues(unit)) if (declared.get(property) !== value) return null;
  }

  // From the last added rule to the first: it may move to the end when no rule that stays after it can disagree
  // about order. The ones that move keep their order among themselves.
  const facts = units.map((unit) => ({ variant: variantOf(unit), properties: declaredProperties(unit) }));
  const moved = new Set<number>();
  for (let at = units.length - 1; at >= 0; at--) {
    if (base.shardOf.has(units[at]!)) continue;
    let movable = true;
    for (let later = at + 1; later < units.length && movable; later++) {
      if (!moved.has(later) && orderMatters(facts[at]!, facts[later]!)) movable = false;
    }
    if (movable) moved.add(at);
  }
  const staying = units.map((unit, at) => ({ unit, at })).filter(({ at }) => !moved.has(at));

  // Where each remaining added rule sits: between two rules of one shard (that shard is carried inline) or not.
  const dirty = new Set<number>();
  let previous = -1;
  const shardAround = staying.map(({ unit }) => base.shardOf.get(unit) ?? -1);
  const after: number[] = new Array(staying.length).fill(-1);
  for (let at = staying.length - 1, upcoming = -1; at >= 0; at--) {
    if (shardAround[at]! >= 0) upcoming = shardAround[at]!;
    after[at] = upcoming;
  }
  for (let at = 0; at < staying.length; at++) {
    const shard = shardAround[at]!;
    if (shard >= 0) { previous = shard; continue; }
    if (previous >= 0 && previous === after[at]) dirty.add(previous);
  }

  const segments: StorySegment[] = [];
  const inline: string[] = [];
  const flush = (): void => { if (inline.length) segments.push({ inline: join(inline.splice(0)) }); };
  const linked = new Set<number>();
  for (const { unit } of staying) {
    const shard = base.shardOf.get(unit);
    if (shard === undefined || dirty.has(shard)) { inline.push(unit); continue; }
    if (!linked.has(shard)) { flush(); segments.push({ shard }); linked.add(shard); }
  }
  // A shard none of whose rules the document restates stays whole; one whose rules were all restated and moved
  // away still stands linked, ahead of what it was restated by (the restatement only adds declarations).
  for (let shard = 0; shard < base.shards.length; shard++) {
    if (linked.has(shard) || dirty.has(shard)) continue;
    const at = segments.findIndex((segment) => 'shard' in segment && segment.shard > shard);
    segments.splice(at < 0 ? segments.length : at, 0, { shard });
  }
  flush();
  for (const at of [...moved].sort((a, b) => a - b)) inline.push(units[at]!);
  flush();
  return segments;
}
