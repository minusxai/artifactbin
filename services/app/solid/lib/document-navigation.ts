/** Cross from a Solid app route to a route owned by the server's document entry. */
export function replaceDocument(target: string): void {
  window.location.replace(target);
}
