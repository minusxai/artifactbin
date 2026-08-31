import { crumbHint } from '@/lib/story-ui/host-classify';

/* Re-exported: the breadcrumb hint is pure class classification (see host-classify). */
export { crumbHint };

/**
 * Story typography vocabulary + class-string algebra (user-driven typography controls).
 *
 * The WYSIWYG typography toolbar edits an element's Tailwind classes directly in the story's
 * JSX source (`className` attr write-back via jsx-edit's applyFormatEditsToJsx). This module is
 * the SINGLE source of truth for:
 *  - which classes the toolbar may apply (curated token scales plus user-picked arbitrary
 *    color utilities), and
 *  - the pure class-string algebra the toolbar AND the source write-back both use, so the live
 *    DOM mutation (instant feedback) and the persisted source always converge.
 *
 * Every finite class listed here is unioned into the story CSS compile (story-css.server.ts), so
 * that palette applies with zero recompile latency. Picker colors are unbounded and therefore
 * compile from the edited story source; the toolbar supplies an ephemeral DOM-only preview while
 * that compile is in flight.
 *
 * Pure module — no DOM, no React — unit-testable in the node project.
 */

/** Ordered font-size scale the size stepper walks — the FULL Tailwind scale (agent-authored
 *  stories freely use the large end). `null` choice = the element's default. */
export const TYPOGRAPHY_SIZE_SCALE = [
  'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl',
  'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl',
] as const;

/**
 * Mutually-exclusive class groups: applying a choice within a group removes the group's other
 * members. Single-member groups (`weight`, `fontStyle`, `decoration`) act as toggles (choice ↔
 * null). Text/fill colors are free values represented by Tailwind arbitrary-value utilities;
 * they are separate from these finite groups.
 */
export const TYPOGRAPHY_GROUPS = {
  size: TYPOGRAPHY_SIZE_SCALE,
  weight: ['font-bold'],
  fontStyle: ['italic'],
  decoration: ['underline'],
  align: ['text-left', 'text-center', 'text-right', 'text-justify'],
} as const satisfies Record<string, readonly string[]>;

export type TypographyGroup = keyof typeof TYPOGRAPHY_GROUPS;

/** Curated Tailwind spacing steps the space-above/below steppers walk (skip-steps match skill usage). */
const SPACING_STEPS = ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24'] as const;

export const SPACE_ABOVE_SCALE: readonly string[] = SPACING_STEPS.map(s => `mt-${s}`);
export const SPACE_BELOW_SCALE: readonly string[] = SPACING_STEPS.map(s => `mb-${s}`);

/**
 * The width scale the stepper walks, narrow → full. `max-w-prose` sits between
 * xl and 2xl by its real rendered width (~65ch). An element with NO constraint
 * reads as `max-w-full` — stepping down from unconstrained starts at 7xl.
 */
export const WIDTH_SCALE: readonly string[] = [
  'max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-prose', 'max-w-2xl', 'max-w-3xl',
  'max-w-4xl', 'max-w-5xl', 'max-w-6xl', 'max-w-7xl', 'max-w-full',
];

/** Per-side padding scales (vertical rhythm belongs to the space above/below steppers). */
export const PAD_LEFT_SCALE: readonly string[] = SPACING_STEPS.map(s => `pl-${s}`);
export const PAD_RIGHT_SCALE: readonly string[] = SPACING_STEPS.map(s => `pr-${s}`);

/**
 * The full-bleed recipe (the story skill's own idiom): escape the page gutter with negative
 * margins and re-add it as inner padding so content stays aligned with the rest of the page.
 */
export const FULL_BLEED_CLASSES = ['-mx-6', '@2xl:-mx-12', 'px-6', '@2xl:px-12'] as const;

/** Every class the toolbar can apply — unioned into the story CSS compile (recipe union). */
export const STORY_WYSIWYG_CLASSES: readonly string[] = [
  // De-duplicated: the bleed recipe's px-6 is also on the side-padding scale.
  ...new Set([
    ...Object.values(TYPOGRAPHY_GROUPS).flat(),
    ...SPACE_ABOVE_SCALE,
    ...SPACE_BELOW_SCALE,
    ...WIDTH_SCALE,
    ...PAD_LEFT_SCALE,
    ...PAD_RIGHT_SCALE,
    ...FULL_BLEED_CLASSES,
  ]),
];

const tokens = (className: string): string[] => className.split(/\s+/).filter(Boolean);

export type StoryColorClassKind = 'text' | 'fill';

const colorPrefix = (kind: StoryColorClassKind): 'text' | 'bg' => kind === 'text' ? 'text' : 'bg';

/**
 * A picker-owned color utility. The important suffix deliberately preserves the old inline-style
 * semantics: a manual user choice beats authored responsive/theme color classes, while clearing
 * the picker removes only this override and reveals the authored colors again.
 */
export function storyColorClass(kind: StoryColorClassKind, hex: string): string {
  return `${colorPrefix(kind)}-[${hex.toLowerCase()}]!`;
}

/** The picker-owned arbitrary hex color on the base element, including pre-important v1 values. */
export function currentStoryColor(className: string, kind: StoryColorClassKind): string | null {
  const prefix = colorPrefix(kind);
  const re = new RegExp(`^${prefix}-\\[(#[0-9a-f]{6})\\]!?$`, 'i');
  for (const token of tokens(className)) {
    const match = re.exec(token);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Replace the picker-owned color for one property without touching any authored named,
 * responsive, or theme-token color utilities. The important picker class wins while present;
 * `null` restores the authored cascade exactly.
 */
export function applyStoryColor(
  className: string,
  kind: StoryColorClassKind,
  hex: string | null,
): string {
  const prefix = colorPrefix(kind);
  const owned = new RegExp(`^${prefix}-\\[#[0-9a-f]{6}\\]!?$`, 'i');
  const kept = tokens(className).filter(token => !owned.test(token));
  if (hex !== null) kept.push(storyColorClass(kind, hex));
  return kept.join(' ');
}

/** `@2xl:text-5xl` → `text-5xl`; unprefixed tokens come back whole. */
const variantTail = (token: string): string => token.slice(token.lastIndexOf(':') + 1);

/** Arbitrary font-size value (`text-[15px]`) — numeric-leading, unlike `text-[#hex]` colors. */
const isArbitrarySize = (token: string): boolean => /^text-\[[0-9.]/.test(token);

/**
 * Whether `token` belongs to `group` for REMOVAL purposes. An explicit choice must displace ANY
 * competing utility the agent authored — group members under variant prefixes (the story skill
 * mandates responsive type like `text-3xl @2xl:text-5xl`, and a surviving variant wins the
 * cascade and masks the choice), and for `size` also arbitrary length values (`text-[15px]`) —
 * while leaving the other `text-*` families (colors, `text-[#hex]`) alone.
 */
function inGroup(token: string, group: TypographyGroup): boolean {
  const tail = variantTail(token);
  if ((TYPOGRAPHY_GROUPS[group] as readonly string[]).includes(tail)) return true;
  return group === 'size' && isArbitrarySize(tail);
}

/** The group member currently present in `className`, or null (first match wins on conflict). */
export function currentChoice(className: string, group: TypographyGroup): string | null {
  const members: readonly string[] = TYPOGRAPHY_GROUPS[group];
  return tokens(className).find(t => members.includes(t)) ?? null;
}

/**
 * Set `choice` within `group` on a class string: every other member of the group is removed
 * (for `size`, any font-size token — see {@link inGroup}); `choice` (when non-null) is appended
 * if absent. Unrelated tokens keep their order; the result is single-space normalized.
 */
export function applyTypographyChoice(
  className: string,
  group: TypographyGroup,
  choice: string | null,
): string {
  const kept = tokens(className).filter(t => !inGroup(t, group) || t === choice);
  if (choice !== null && !kept.includes(choice)) kept.push(choice);
  return kept.join(' ');
}

/**
 * Step the font size along TYPOGRAPHY_SIZE_SCALE — RELATIVE semantics: every size token shifts
 * one step IN PLACE, variant-prefixed ones included (`text-3xl @2xl:text-5xl` →
 * `text-4xl @2xl:text-6xl`), so the skill's responsive type ratios survive the click. Each
 * token clamps at the scale ends independently. An element with no base size steps from
 * `text-base` (appended); arbitrary size values (`text-[15px]`) are replaced by the stepped
 * scale — stepping means the user is taking manual control.
 */
/** One steppable utility scale: ordered tokens + where a bare element sits + its arbitrary form. */
interface ClassScaleSpec {
  tokens: readonly string[];
  /** Treated as the current position when the element carries no scale token. */
  defaultToken: string;
  /** Arbitrary-value form of this utility (`text-[15px]`, `mt-[18px]`) — replaced on step. */
  arbitraryRe: RegExp;
}

/**
 * Generic RELATIVE stepper over a utility scale: every matching token shifts one step IN
 * PLACE, variant-prefixed ones included, clamping at the scale ends per token — so the skill's
 * responsive patterns (`text-3xl @2xl:text-5xl`, `mt-4 @2xl:mt-10`) survive the click.
 * Arbitrary values are replaced by the stepped scale (stepping = the user taking manual
 * control). With no bare token, steps from `defaultToken`, appending the result — unless the
 * step clamps back onto the default itself, which stays unwritten (no `mt-0` for nothing).
 */
function stepScaleClass(className: string, spec: ClassScaleSpec, direction: 1 | -1): string {
  const shift = (t: string): string =>
    spec.tokens[Math.min(spec.tokens.length - 1, Math.max(0, spec.tokens.indexOf(t) + direction))];
  let sawBase = false;
  const out: string[] = [];
  for (const token of tokens(className)) {
    const tail = variantTail(token);
    if (spec.tokens.includes(tail)) {
      if (tail === token) sawBase = true;
      out.push(token.slice(0, token.length - tail.length) + shift(tail));
      continue;
    }
    if (spec.arbitraryRe.test(tail)) continue; // dropped — replaced by the stepped scale below
    out.push(token);
  }
  if (!sawBase) {
    const stepped = shift(spec.defaultToken);
    if (stepped !== spec.defaultToken) out.push(stepped);
  }
  return out.join(' ');
}

const SIZE_SPEC: ClassScaleSpec = {
  tokens: TYPOGRAPHY_SIZE_SCALE,
  defaultToken: 'text-base',
  arbitraryRe: /^text-\[[0-9.]/,
};

const SPACING_SPECS: Record<'above' | 'below', ClassScaleSpec> = {
  above: { tokens: SPACE_ABOVE_SCALE, defaultToken: 'mt-0', arbitraryRe: /^mt-\[/ },
  below: { tokens: SPACE_BELOW_SCALE, defaultToken: 'mb-0', arbitraryRe: /^mb-\[/ },
};

export function stepSizeClass(className: string, direction: 1 | -1): string {
  return stepScaleClass(className, SIZE_SPEC, direction);
}

/**
 * Step the spacing above/below an element along the curated {@link SPACING_STEPS} scale —
 * same relative semantics as {@link stepSizeClass}. Stepping DOWN from no margin is a no-op.
 */
export function stepSpacingClass(className: string, edge: 'above' | 'below', direction: 1 | -1): string {
  return stepScaleClass(className, SPACING_SPECS[edge], direction);
}

/**
 * The BARE spacing step for an edge ('4' for `mt-4`), or null when the element carries none
 * (absent, variant-only, or arbitrary) — the toolbar's readout, mirroring how the size label
 * reads only the base token.
 */
export function currentSpacingStep(className: string, edge: 'above' | 'below'): string | null {
  const spec = SPACING_SPECS[edge];
  const token = tokens(className).find(t => (spec.tokens as readonly string[]).includes(t));
  return token ? token.slice(token.indexOf('-') + 1) : null;
}

const PADDING_SPECS: Record<'left' | 'right', ClassScaleSpec> = {
  left: { tokens: PAD_LEFT_SCALE, defaultToken: 'pl-0', arbitraryRe: /^pl-\[/ },
  right: { tokens: PAD_RIGHT_SCALE, defaultToken: 'pr-0', arbitraryRe: /^pr-\[/ },
};

/** Step one side's padding (`pl-*`/`pr-*`) — same independent-edges shape as the margin steppers. */
export function stepPaddingClass(className: string, side: 'left' | 'right', direction: 1 | -1): string {
  return stepScaleClass(className, PADDING_SPECS[side], direction);
}

/** The BARE step for a side ('6' for `pl-6`), or null when none — the toolbar's readout. */
export function currentPaddingStep(className: string, side: 'left' | 'right'): string | null {
  const spec = PADDING_SPECS[side];
  const token = tokens(className).find(t => (spec.tokens as readonly string[]).includes(t));
  return token ? token.slice(token.indexOf('-') + 1) : null;
}

/**
 * The most decision-relevant class for a selection breadcrumb crumb: the width constraint
 * first (`max-w-*` — exactly what "why isn't this full width" needs to see), then the layout
 * role (`grid`/`flex`), then a background. Empty when nothing salient.
 */
const isMaxWidthToken = (token: string): boolean => variantTail(token).startsWith('max-w-');

/**
 * Strip every width constraint (`max-w-*` in all forms — named, arbitrary, variant-prefixed),
 * returning the stripped class string and the removed tokens. The width stepper's ground
 * truth: stepping replaces whatever constraint mix an element carried with one scale token.
 */
export function stripMaxWidth(className: string): { className: string; removed: string[] } {
  const all = tokens(className);
  return {
    className: all.filter(t => !isMaxWidthToken(t)).join(' '),
    removed: all.filter(isMaxWidthToken),
  };
}

/**
 * Step the element's width along {@link WIDTH_SCALE}. Unconstrained reads as
 * `max-w-full` (stepping up is then a no-op that writes nothing); any variant
 * or arbitrary constraint is replaced by the stepped scale — stepping means
 * the user is taking manual control, same policy as the other steppers.
 */
export function stepWidthClass(className: string, direction: 1 | -1): string {
  const bare = tokens(className).find(t => (WIDTH_SCALE as readonly string[]).includes(t));
  const current = bare ?? 'max-w-full';
  const idx = WIDTH_SCALE.indexOf(current);
  const next = WIDTH_SCALE[Math.min(WIDTH_SCALE.length - 1, Math.max(0, idx + direction))];
  const { className: stripped, removed } = stripMaxWidth(className);
  // Already effectively full and staying full: leave the element unwritten.
  if (!bare && removed.length === 0 && next === 'max-w-full') return className;
  return [stripped, next].filter(Boolean).join(' ');
}

/** The BARE width-scale tail ('prose' for `max-w-prose`), or null when unconstrained/arbitrary. */
export function currentWidthStep(className: string): string | null {
  const bare = tokens(className).find(t => (WIDTH_SCALE as readonly string[]).includes(t));
  return bare ? bare.slice('max-w-'.length) : null;
}
