/** Reader-facing metadata only. Source parsing belongs to the server and lazy editor. */
export const UNTITLED = 'Untitled';

export function displayTitle(row: { title?: string | null; heading?: string | null }): string {
  return row.title?.trim() || row.heading || UNTITLED;
}
