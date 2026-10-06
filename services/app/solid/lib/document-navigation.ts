/** Cross from a Solid app route to a route owned by the server's document entry. */
export function openDocument(target: string): void {
  window.location.assign(target);
}

/** Replace an intermediate redirect page without leaving it in browser history. */
export function replaceDocument(target: string): void {
  window.location.replace(target);
}
