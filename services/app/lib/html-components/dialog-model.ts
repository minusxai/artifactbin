/**
 * Internal: focus-trap stops, attribute restore, label ids and styles for af-dialog.
 * Used by: dialog.ts.
 */
let sequence = 0;
/** Give a title/description node a document-unique id so the dialog can reference it. */
export function identify(node: HTMLElement): void {
  if (node.id) return;
  let id: string;
  do { id = `af-dialog-label-${++sequence}`; } while (node.ownerDocument.getElementById(id));
  node.id = id;
}
/** Put back an authored attribute value; null means it was absent. */
export function restoreAttribute(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name); else node.setAttribute(name,value);
}
/** Focusable stops inside the open dialog, skipping disabled, hidden, inert and unrendered ones. */
export function tabStops(native: HTMLDialogElement): HTMLElement[] {
  return [...native.querySelectorAll<HTMLElement>(
    'button,input,select,textarea,a[href],[tabindex]')].filter(node => {
    if(node.tabIndex < 0 || node.matches(':disabled,[disabled],[aria-disabled="true"]') ||
      node.closest('[hidden],[inert],fieldset[disabled]')) return false;
    for(let ancestor: HTMLElement | null = node; ancestor && ancestor !== native;
      ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if(style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}
export const dialogStyles =
  '\n' +
  'af-dialog{display:contents}\n' +
  'dialog[data-af-dialog-native]{margin:auto;max-height:calc(100svh - 4rem);width:fit-content;' +
  'max-width:min(32rem,calc(100vw - 2rem));overflow:auto;border-radius:var(--radius-lg,' +
  'var(--radius,.625rem));border:1px solid var(--border);background:var(--background);' +
  'padding:1.5rem;color:var(--foreground);box-shadow:var(--shadow-lg,0 10px 15px -3px rgb(0 0 0 ' +
  '/ 10%),0 4px 6px -4px rgb(0 0 0 / 10%))}\n' +
  'af-dialog-content{display:flex;flex-direction:column;gap:1rem}\n' +
  'af-dialog-content h2{font-family:var(--font-display,inherit);font-weight:600}\n' +
  'af-dialog-content p:not([class]){line-height:1.65;margin:.75rem 0}\n' +
  'af-dialog-content h2:not([class]){font-size:1.75rem;font-weight:600;line-height:1.2;' +
  'margin-block:1.6em .5em;text-wrap:balance}\n' +
  '@media(max-width:639px){af-dialog-content h2:not([class]){font-size:1.5rem}}\n' +
  'af-dialog-header{display:flex;flex-direction:column;gap:.5rem}\n' +
  'af-dialog-footer{display:flex;justify-content:flex-end;gap:.5rem}\n' +
  'af-dialog-title{display:block;font-family:var(--font-display,inherit);font-size:1.125rem;' +
  'font-weight:600;line-height:1}\n' +
  'af-dialog-description{display:block;color:var(--muted-foreground);font-size:.875rem}\n' +
  'af-dialog-trigger,af-dialog-close{display:inline-flex;align-items:center;' +
  'justify-content:center;gap:.5rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - ' +
  '2px));padding:.5rem 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;' +
  'background:var(--primary);color:var(--primary-foreground)}\n' +
  'af-dialog-trigger:has(button,input,select,textarea,a[href]),af-dialog-close:has(button,input,' +
  'select,textarea,a[href]){display:contents}\n' +
  'af-dialog-trigger>button{box-sizing:border-box;display:inline-flex;height:2.25rem;' +
  'align-items:center;justify-content:center;gap:.5rem;border:0;border-radius:var(--radius-md,' +
  'calc(var(--radius,.625rem) - 2px));padding:.5rem 1rem;font:inherit;font-size:.875rem;' +
  'font-weight:500;cursor:pointer;background:var(--primary);color:var(--primary-foreground)}\n' +
  'af-dialog-trigger:not([disabled]):hover,' +
  'af-dialog-trigger:not([disabled])>button:not(:disabled):not([aria-disabled="true"]):hover{back' +
  'ground:color-mix(in oklab,var(--primary,#171717) 90%,transparent)}\n' +
  'af-dialog-close{border:1px solid currentColor;background:var(--background);' +
  'color:var(--foreground);box-shadow:var(--shadow-xs,0 1px 2px 0 rgb(0 0 0 / 0.05))}\n' +
  'af-dialog-close>button{box-sizing:border-box;display:inline-flex;align-items:center;' +
  'justify-content:center;gap:.5rem;border:1px solid currentColor;border-radius:var(--radius-md,' +
  'calc(var(--radius,.625rem) - 2px));padding:.5rem 1rem;font:inherit;font-size:.875rem;' +
  'font-weight:500;cursor:pointer;background:var(--background);color:var(--foreground);' +
  'box-shadow:var(--shadow-xs,0 1px 2px 0 rgb(0 0 0 / 0.05))}\n' +
  ':root[data-af-dark="true"] af-dialog-close,:root[data-af-dark="true"] ' +
  'af-dialog-close>button{border-color:var(--input);background:color-mix(in oklab,var(--input) ' +
  '30%,transparent)}\n' +
  'af-dialog-trigger:focus-visible,af-dialog-close:focus-visible,' +
  'af-dialog-trigger>button:focus-visible,af-dialog-close>button:focus-visible{outline:none;' +
  'border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}' +
  '\n' +
  'af-dialog-trigger[disabled],af-dialog-close[disabled]{opacity:.5;cursor:default}\n' +
  'af-dialog-trigger[disabled]>button,af-dialog-trigger>button:disabled,' +
  'af-dialog-trigger>button[aria-disabled="true"]{opacity:.5;cursor:default}\n' +
  'af-dialog-close[disabled]>button,af-dialog-close>button:disabled,' +
  'af-dialog-close>button[aria-disabled="true"]{opacity:.5;cursor:default}\n';
