/**
 * THE SHELL'S LOOK ON THE APP'S DISCUSSION (./browser-host-comments): the documented theme tokens a host page sets
 * (lib/html-systems THEME_TOKENS, `/af/manifest.json` `theme`: `--background`, `--card`, `--border`, `--primary`, …)
 * mapped onto the app's own tokens inside a trusted root, so the comments a shell shows wear the shell's palette, radii
 * and faces, light and dark alike.
 *
 * A trusted root resets every custom property the app's sheet names (lib/ui-runtime/trusted-ui-styles), so the tokens
 * are read where the shell's values still hold: on the root's HOST element (`:host`, outside the reset), under names the
 * app's sheet never uses. The root then maps them, and only when the shell sets them at all (`hostSetsTheme`, the
 * attribute below): a shell that sets none keeps the app's own look. This sheet is the host's alone; the app's own
 * document page never carries it, and author CSS never reaches a trusted root.
 */
export const HOST_THEME_ATTR = 'data-af-host-theme';

const READ: Record<string, string> = {
  bg: 'background', fg: 'foreground', card: 'card', popover: 'popover', muted: 'muted', mutedfg: 'muted-foreground',
  primary: 'primary', primaryfg: 'primary-foreground', destructive: 'destructive', border: 'border', input: 'input',
  radius: 'radius', rsm: 'radius-sm', rmd: 'radius-md', rlg: 'radius-lg', body: 'font-body', mono: 'font-mono',
};
const host = (name: string) => `var(--afh-${name})`;
/** App token ← the shell's (a missing optional token falls back to its kin, then to the app's own value). */
const MAP: Record<string, string> = {
  '--color-bg': host('bg'), '--color-surface': host('card'), '--color-raised': host('muted'), '--color-code': host('muted'),
  '--color-code-edge': host('border'), '--color-comment': host('card'), '--color-comment-hover': `var(--afh-popover, ${host('card')})`,
  '--color-edge': host('border'), '--color-edge-bright': `var(--afh-input, ${host('border')})`, '--color-fg': host('fg'),
  '--color-muted': host('mutedfg'), '--color-faint': `color-mix(in srgb, ${host('mutedfg')} 65%, ${host('bg')})`,
  '--color-accent': host('primary'), '--color-action': host('primary'), '--color-action-ink': host('primaryfg'),
  '--color-accent-soft': `color-mix(in srgb, ${host('primary')} 15%, ${host('bg')})`, '--color-danger': host('destructive'),
  '--color-danger-soft': `color-mix(in srgb, ${host('destructive')} 12%, ${host('bg')})`,
  '--radius-chip': `var(--afh-rsm, var(--afh-radius, 4px))`, '--radius-control': `var(--afh-rmd, var(--afh-radius, 6px))`,
  '--radius-panel': `var(--afh-rlg, var(--afh-radius, 8px))`, '--radius-dialog': `var(--afh-rlg, var(--afh-radius, 12px))`,
  '--font-sans': `var(--afh-body, ui-sans-serif, system-ui, sans-serif)`, '--font-mono': `var(--afh-mono, ui-monospace, monospace)`,
};
const ROOT = `[data-trusted-ui-root][${HOST_THEME_ATTR}]`;
/** Appended after the app's sheet in each root: same specificity as the app's `[data-theme]` palettes, later, so it wins. */
export const HOST_THEME_CSS = `:host{${Object.entries(READ).map(([alias, token]) => `--afh-${alias}:var(--${token});`).join('')}}
${ROOT},${ROOT}[data-theme]{${Object.entries(MAP).map(([token, value]) => `${token}:${value};`).join('')}}`;

/** Does the shell set the theme tokens where this root lives? (`--background` stands for the set: every system defines all.) */
export function hostSetsTheme(win: Window, at: Element): boolean {
  return win.getComputedStyle(at).getPropertyValue('--background').trim() !== '';
}
