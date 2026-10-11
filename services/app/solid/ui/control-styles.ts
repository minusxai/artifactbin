/**
 * The control geometry every solid/ui control shares, so a Button, Input, Select and Tabs of one size are the
 * same height, radius, border and focus ring. Two densities: `md` is form density, `sm` is chrome density
 * (toolbars, panels, menus); a Button adds `xs`, the dense icon toolbar and comment rail (24px, growing to a
 * 36px target on a touch pointer), and `bar`, the app bar's 36px. Private to solid/ui: callers pick a `size`, never these strings.
 */
export type ControlSize = 'md' | 'sm';
/** A Button also comes extra-compact (`xs`) and at the app bar's 36px (`bar`, the reader-shell gate's touch target). */
export type ButtonSize = ControlSize | 'xs' | 'bar';

export const CONTROL_SIZE: Record<ButtonSize, string> = {
  md: 'h-control rounded-control px-3.5 font-sans text-sm',
  sm: 'h-control-sm rounded-control px-2.5 font-mono text-xs',
  xs: 'h-control-xs rounded-chip px-1.5 font-mono text-2xs pointer-coarse:min-h-9',
  bar: 'h-9 rounded-control px-3 font-mono text-xs',
};
/** Square icon-only geometry of the same heights; the chrome sizes keep a 36px target under a finger. */
export const ICON_SIZE: Record<ButtonSize, string> = {
  md: 'size-control rounded-control px-0 font-sans text-sm',
  sm: 'size-control-sm rounded-control px-0 font-mono text-xs pointer-coarse:min-h-9 pointer-coarse:min-w-9',
  xs: 'size-control-xs rounded-chip px-0 font-mono text-2xs pointer-coarse:min-h-9 pointer-coarse:min-w-9',
  bar: 'size-9 rounded-control px-0 font-mono text-xs',
};
export const FOCUS_RING = 'outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30';
export const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-50';
/** The editable surface of an Input, Textarea, SearchField and a Select's trigger. */
export const FIELD_SURFACE = 'w-full min-w-0 border border-edge-bright bg-surface text-fg placeholder:text-faint transition-colors';
