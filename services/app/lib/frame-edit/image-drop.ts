/**
 * The image inside a paste or a drop — PURE.
 *
 * A `ClipboardEvent` and a `DragEvent` differ only in which property holds the
 * DataTransfer (`clipboardData` / `dataTransfer`), so one function serves both
 * doors and there is a single answer to "is this an image insert?".
 *
 * Both views are consulted because neither alone is enough: a clipboard image
 * appears on `items` (where `files` is empty in some browsers), while a dropped
 * file appears on `files`. `items` goes first because it is the only view that
 * distinguishes a FILE from the text/html a rich paste also carries — which is
 * what keeps an ordinary text paste from being swallowed here.
 */

/** The first image in a paste/drop payload, or null if it carries none. */
export function imageFileFromTransfer(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && file.type.startsWith('image/')) return file;
  }
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}
