/** Internal: attribute restore and the light-DOM stylesheet for af-popover. Used by: popover.ts. */
/** Put back an authored attribute value; null means it was absent. */
export function restoreAttribute(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name); else node.setAttribute(name,value);
}
export const popoverStyles =
  '\n' +
  'af-popover{display:contents}\n' +
  'af-popover-trigger{cursor:pointer;line-height:1.5}\n' +
  'af-popover-trigger>button{box-sizing:border-box;margin:0;padding:0;border:0;border-radius:0;' +
  'background:transparent;color:inherit;font:inherit;line-height:inherit;cursor:inherit}\n' +
  'af-popover-trigger[disabled]>button,af-popover-trigger>button:disabled,' +
  'af-popover-trigger>button[aria-disabled="true"]{opacity:.5;cursor:default}\n' +
  'af-popover-trigger:focus-visible{outline:2px solid var(--ring);outline-offset:2px}\n' +
  'af-popover-trigger[disabled]{opacity:.5;cursor:default}\n' +
  'af-popover-content{box-sizing:border-box;position:fixed;inset:auto;margin:0;z-index:50;' +
  'width:18rem;max-width:calc(100vw - 1rem);max-height:calc(100svh - 1rem);overflow:auto;' +
  'border:1px solid currentColor;border-radius:var(--radius-md,calc(var(--radius,.625rem) - ' +
  '2px));padding:1rem;line-height:1.5;background:var(--popover,var(--background));' +
  'color:var(--popover-foreground,var(--foreground));box-shadow:var(--shadow-md,0 4px 6px -1px ' +
  'rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}\n' +
  ':where(af-popover-content) :where(p):not([class]){margin-block:.75em;max-width:68ch;' +
  'line-height:1.65}\n' +
  'af-popover-content[hidden]{display:none!important}\n' +
  'af-popover-header{display:flex;flex-direction:column;gap:.25rem;font-size:.875rem}\n' +
  'af-popover-title{display:block;font-weight:500}\n' +
  'af-popover-description{display:block;color:var(--muted-foreground)}';
