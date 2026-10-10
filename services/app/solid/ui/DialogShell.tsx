/* @jsxImportSource solid-js */
/**
 * The modal contract (lib/islands/kit/dialog-shell) as a wrapper: it owns Escape, the Tab trap,
 * focus restore and the optional scroll lock for as long as it is mounted, over the `role="dialog"`
 * element its child is or contains. The caller keeps its own portal, backdrop and markup.
 */
import { children as resolveChildren, type JSX } from 'solid-js';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';

export function DialogShell(props: { onClose: () => void; lockScroll?: boolean; initialFocus?: string; children: JSX.Element }): JSX.Element {
  const child = resolveChildren(() => props.children);
  const panel = () => {
    const root = child.toArray().find((node): node is HTMLElement => node instanceof HTMLElement);
    return root?.matches('[role="dialog"], [role="alertdialog"]') ? root : root?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? undefined;
  };
  createDialogShell({
    panel,
    onClose: () => props.onClose(),
    lockScroll: props.lockScroll,
    initialFocus: () => (props.initialFocus ? panel()?.querySelector<HTMLElement>(props.initialFocus) : undefined),
  });
  return <>{child()}</>;
}
