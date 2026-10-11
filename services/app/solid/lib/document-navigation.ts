/** Cross from a Solid app route to a route owned by the server's document entry. */
export function openDocument(target: string): void {
  window.location.assign(target);
}

/**
 * Replace an intermediate page without leaving it in browser history. The SAME address (an app page that found
 * the server owns it) is a reload: `replace` to the address already open, fragment included, is only a fragment
 * navigation and would load nothing.
 */
export function replaceDocument(target: string): void {
  const here = window.location;
  if (new URL(target, here.href).href === here.href) here.reload();
  else here.replace(target);
}
