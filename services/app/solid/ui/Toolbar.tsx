/* @jsxImportSource solid-js */
/**
 * THE TOOLBAR: a named `role="toolbar"` row of controls (Buttons, Selects, a Popover's trigger) drawn as one chrome
 * strip — a text editor's formatting bar. Per the WAI-ARIA toolbar pattern ArrowLeft/ArrowRight (wrapping), Home and
 * End move the focus between its enabled controls; every control stays reachable by Tab too. `ToolbarSeparator`
 * divides groups of controls. With `keepFocus`, pressing a plain button does not take the focus from where the person
 * is typing (an editor the toolbar acts on keeps its caret); a button that opens a popup (a Select, a Popover) still
 * takes it, so its popup has the keyboard, and keyboard focus reaches every control.
 */
import { splitProps, type JSX } from 'solid-js';

const CONTROLS = 'button:not(:disabled), [role="combobox"]:not(:disabled), input:not(:disabled)';

export function Toolbar(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'role'> & { label: string; keepFocus?: boolean; class?: string; children: JSX.Element }): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'keepFocus', 'class', 'children']);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.defaultPrevented) return;
    const bar = event.currentTarget as HTMLElement;
    // Only between the bar's own controls: an open popup's keys are its own.
    const controls = [...bar.querySelectorAll<HTMLElement>(CONTROLS)];
    // Inside a shadow root (the trusted UI) the focused control is the root's, not the document's.
    const at = controls.indexOf((bar.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement);
    if (at < 0 || !controls.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
    controls[next]!.focus();
  };
  return <div {...rest} role="toolbar" aria-label={own.label} aria-orientation="horizontal" onKeyDown={onKeyDown}
    onMouseDown={(event) => { if (own.keepFocus && (event.target as Element).closest?.('button:not([aria-haspopup])')) event.preventDefault(); }}
    class={`flex min-w-0 flex-wrap items-center gap-1 rounded-panel border border-edge bg-surface px-1.5 py-1 font-sans text-fg shadow-sm ${own.class ?? ''}`}>
    {own.children}
  </div>;
}

export function ToolbarSeparator(): JSX.Element {
  return <div role="separator" aria-orientation="vertical" class="mx-1 h-5 w-px shrink-0 bg-edge" />;
}
