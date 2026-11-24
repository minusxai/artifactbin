/**
 * A design-system spec as CSS, at run time: the same code path as the build's generator
 * (design-systems/lib/runtime.mjs `varsMap`, pages.mjs `typeCss`, html-skill.mjs `nativeSystemRules` and the
 * shipped sheet's header), for the one system the build cannot see, the installation's (./installation.server).
 * `system-css.test.ts` pins it byte for byte against every built-in's generated rules and shipped stylesheet, so
 * the two cannot drift. Two additions apply only to a spec that uses them, and no built-in does: an explicit
 * `radius_scale`, and the light-only lock for a spec without dark values.
 */

import { THEME_TOKENS, THEME_TYPE_ROLES } from './html-systems';
export { CONTRACT_KEYS } from './html-systems';

interface SpecToken { name: string; light: string; dark?: string; usage?: string; group?: string }
interface SpecTypeRole {
  name: string; family: 'display' | 'sans' | 'mono'; size: string; lh: string; weight: number | string;
  ls?: string; tt?: string; fs?: string; extra?: string; sample?: string; usage?: string;
}
/** The runtime subset of design-systems/specs/<slug>.json, plus `radius_scale`. */
export interface DesignSystemSpec {
  slug: string; name: string; tagline?: string; mood?: string; jobs?: string; idea?: string; use_for?: string; avoid_when?: string;
  color_mode?: 'light' | 'dark';
  families: { display: string; sans: string; mono: string };
  tokens: SpecToken[];
  contract: Record<string, string>;
  radius_contract: string;
  /** Explicit OPTIONAL_THEME_TOKENS radius steps; a step left out keeps the components' derivation from --radius. */
  radius_scale?: Partial<Record<(typeof RADIUS_STEPS)[number], string>>;
  extra_vars?: Record<string, string | { light?: string | null; dark?: string | null }>;
  type_roles?: SpecTypeRole[];
  chart_series?: string[];
  status_alias?: Record<string, string> | null;
}

export const STATUS_TOKENS = ['positive', 'positive-soft', 'caution', 'caution-soft', 'negative', 'negative-soft'] as const;
export const RADIUS_STEPS = ['sm', 'md', 'lg', 'full'] as const;

/** design-systems/lib/token-colors.mjs TOKEN_RULES: highlight-token colours on the theme tokens. */
const TOKEN_RULES: ReadonlyArray<{ names: string[]; hue?: string; mix?: number; css?: string }> = [
  { names: ['comment', 'quote', 'meta'], hue: '--muted-foreground', mix: 75, css: 'font-style:italic' },
  { names: ['keyword', 'selector-tag', 'doctag', 'name'], hue: '--primary', mix: 66 },
  { names: ['string', 'regexp', 'template-variable', 'addition'], hue: '--chart-2', mix: 59 },
  { names: ['number', 'literal', 'symbol', 'bullet'], hue: '--chart-3', mix: 35 },
  { names: ['title', 'section', 'selector-id', 'selector-class'], hue: '--foreground', mix: 100, css: 'font-weight:600' },
  { names: ['title.class_', 'type', 'built_in', 'class'], hue: '--chart-4', mix: 47 },
  { names: ['attr', 'attribute', 'property', 'variable', 'params'], hue: '--chart-1', mix: 66 },
  { names: ['tag', 'operator', 'punctuation'], hue: '--muted-foreground', mix: 75 },
  { names: ['deletion'], hue: '--destructive', mix: 66 },
  { names: ['emphasis'], css: 'font-style:italic' },
  { names: ['strong'], css: 'font-weight:700' },
];
const tokenRuleCss = (rule: (typeof TOKEN_RULES)[number]) => [rule.hue && (rule.mix! >= 100 ? `color:var(${rule.hue})` : `color:color-mix(in oklab, var(${rule.hue}) ${rule.mix}%, var(--foreground))`), rule.css].filter(Boolean).join(';');
const tokenCss = (selector: string) => TOKEN_RULES.map((rule) => `${rule.names.map((name) => `${selector} .tok-${name}`).join(', ')} { ${tokenRuleCss(rule)}; }`).join('\n');

/** True when every token has a dark value; a spec without any is light-only. */
export const specHasDark = (spec: DesignSystemSpec): boolean => spec.tokens.every((token) => token.dark !== undefined);

/** runtime.mjs `varsMap`: the variable block as a map, in the order the generator writes it. */
export function specVars(spec: DesignSystemSpec, mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  const names = new Set(spec.tokens.map((token) => token.name));
  for (const token of spec.tokens) out[`--ds-${token.name}`] = mode === 'dark' && token.dark !== undefined ? token.dark : token.light;
  const alias = spec.status_alias ?? {};
  for (const status of STATUS_TOKENS) if (!names.has(status) && status in alias) out[`--ds-${status}`] = `var(--ds-${alias[status]})`;
  for (const [key, source] of Object.entries(spec.contract)) out[`--${key}`] = `var(--ds-${source})`;
  if (mode === 'light') {
    out['--radius'] = spec.radius_contract;
    for (const step of RADIUS_STEPS) if (spec.radius_scale?.[step] !== undefined) out[`--radius-${step}`] = spec.radius_scale[step]!;
    out['--font-display'] = spec.families.display; out['--font-body'] = spec.families.sans; out['--font-mono'] = spec.families.mono;
  }
  for (const [key, value] of Object.entries(spec.extra_vars ?? {})) {
    const resolved = value && typeof value === 'object' ? value[mode] : value;
    if (resolved !== null && resolved !== undefined) out[`--ds-${key}`] = resolved;
  }
  return out;
}

/** pages.mjs `typeCss`: one rule per type role. */
function typeCss(spec: DesignSystemSpec, selector: string): string {
  return (spec.type_roles ?? []).map((role) => {
    const props = [`font-family: ${spec.families[role.family]}`, `font-size: ${role.size}`, `line-height: ${role.lh}`, `font-weight: ${role.weight}`];
    if (role.ls) props.push(`letter-spacing: ${role.ls}`);
    if (role.tt) props.push(`text-transform: ${role.tt}`);
    if (role.fs) props.push(`font-style: ${role.fs}`);
    if (role.extra) props.push(role.extra);
    return `${selector} .t-${role.name} { ${props.join('; ')}; }`;
  }).join('\n');
}

const note = (text: unknown) => String(text ?? '').replaceAll('*/', '* /').replace(/\s+/g, ' ').trim();

/** html-skill.mjs `nativeSystemRules`: the platform rules (`comments` false) or the shipped sheet's (true). */
export function specRules(spec: DesignSystemSpec, { comments = false } = {}): string {
  const selector = `:root[data-af-design-system="${spec.slug}"]`;
  const usage = new Map(spec.tokens.map((token) => [`--ds-${token.name}`, token.usage]));
  const vars = (mode: 'light' | 'dark', documented: boolean) => Object.entries(specVars(spec, mode)).map(([key, value]) => `  ${key}: ${value};${documented && comments && usage.get(key) ? ` /* ${note(usage.get(key))} */` : ''}`).join('\n');
  const roles = typeCss(spec, selector).split('\n').map((rule, index) => {
    const role = spec.type_roles?.[index];
    return comments && role ? `/* ${note(role.usage)} */\n${rule}` : rule;
  }).join('\n');
  const lead = (text: string) => comments ? `/* ${text} */\n` : '';
  const zero = (sel: string) => comments ? sel : `:where(${sel})`;
  // A light-only system keeps its light values and native controls under data-af-dark="true" (the core's inline
  // color-scheme included): its dark block repeats the light tokens, and this rule holds the scheme.
  const lock = specHasDark(spec) ? '' : `${lead('Light-only: no dark values, so data-af-dark="true" keeps the light palette.')}${selector}[data-af-dark="true"] { color-scheme: light !important; }\n`;
  return `${lead('Light values; --ds-* are this system\'s own palette, each annotated with its use.')}${zero(selector)} {\n${vars('light', true)}\n}\n${lead('Dark values: the same tokens, under data-af-dark="true".')}${zero(`${selector}[data-af-dark="true"]`)} {\n${vars('dark', false)}\n}\n${lock}${selector} body { margin:0; background:var(--background); color:var(--foreground); font-family:var(--font-body); }\n${lead('Type roles and when to use them.')}${roles}\n${lead('Code highlighting token colours (for @afbin/highlight).')}${tokenCss(selector)}\n`;
}

/** Wrap prose to a readable width, each line prefixed as a comment line. */
function wrap(text: string, indent = ''): string {
  const lines: string[] = []; let line = '';
  for (const word of text.split(' ')) {
    if ((indent + line + ' ' + word).length > 112 && line) { lines.push(indent + line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(indent + line);
  return lines.map((text) => ` * ${text}`).join('\n');
}

/** html-skill.mjs `cssHeader`: how a page uses the sheet, the shared contract, this system's brief. `source` names
 * where the spec came from; an absent brief field (an installation spec's are optional) leaves its line out. */
function specHeader(spec: DesignSystemSpec, source?: string): string {
  const roleNames = source ? (spec.type_roles ?? []).map((role) => `t-${role.name}`) : THEME_TYPE_ROLES;
  const roleHeading = source ? 'Type-role classes available in this installation:' :
    'Type-role classes shared by every system, used as class="t-title" etc.:';
  const origin = source ?? `design-systems/specs/${spec.slug}.json`;
  const brief = ([['Idea', spec.idea], ['Use for', spec.use_for], ['Avoid when', spec.avoid_when]] as const).filter(([, text]) => text !== undefined).map(([label, text]) => `${wrap(`${label}: ${note(text)}`)}\n`).join('');
  return `/*
 * ${spec.name}: ${note(spec.tagline)}
${wrap(`${note(spec.jobs)}. Mood: ${note(spec.mood)}. Opens ${spec.color_mode ?? 'light'}. Generated from ${origin}.`)}
 *
${wrap(`Use <meta name="artifactbin:design-system" content="${spec.slug}"> in <head>. The platform loads the CSS and fonts and sets data-af-design-system and data-af-dark.`)}
 *
${wrap('Shared contract: every system defines these, so build your CSS on them with var(--name):')}
${wrap(THEME_TOKENS.join(' '), '  ')}
${wrap(roleHeading)}
${wrap(roleNames.join(' '), '  ')}
${wrap('The --ds-* palette and any unlisted type roles are system-specific.')}
 *
${brief} */
`;
}

/** html-skill.mjs `nativeSystemCss`: the shipped design-systems/<slug>.css, with `faces` its @font-face rules. */
export function specStylesheet(spec: DesignSystemSpec, faces: string, source?: string): string {
  return `${specHeader(spec, source)}${specRules(spec, { comments: true })}\n/* Font faces: the platform hosts these files; they stay here so the sheet is complete on its own. */\n${faces}\n`;
}
