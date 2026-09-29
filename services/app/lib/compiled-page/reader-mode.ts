/** Reader selection for a prepared document (docs/phase2-architecture.md §10).
 * Editing and commenting need their dedicated interactive copy; every other
 * reader view uses the compiled page, with an explicit fallback on failure.
 */
export function compiledReaderForView(options: { editing?: boolean; commenting?: boolean } = {}): boolean {
  return !options.editing && !options.commenting;
}
