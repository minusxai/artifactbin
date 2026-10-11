/**
 * The control geometry every solid/ui control shares, so a Button, Input, Select and Tabs of one size are the
 * same height, radius, border and focus ring. Two densities: `md` is form density, `sm` is chrome density
 * (toolbars, panels, menus). Private to solid/ui: callers pick a `size`, never these strings.
 */
export type ControlSize = 'md' | 'sm';

export const CONTROL_SIZE: Record<ControlSize, string> = {
  md: 'h-control rounded-control px-3.5 font-sans text-sm',
  sm: 'h-control-sm rounded-control px-2.5 font-mono text-xs',
};
/** Square icon-only geometry of the same two heights. */
export const ICON_SIZE: Record<ControlSize, string> = {
  md: 'size-control rounded-control px-0 font-sans text-sm',
  sm: 'size-control-sm rounded-control px-0 font-mono text-xs',
};
export const FOCUS_RING = 'outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30';
export const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-50';
/** The editable surface of an Input, Textarea, SearchField and a Select's trigger. */
export const FIELD_SURFACE = 'w-full min-w-0 border border-edge-bright bg-surface text-fg placeholder:text-faint transition-colors';
