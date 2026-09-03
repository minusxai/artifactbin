/**
 * A file size as a person reads it — pure, tiny, and shared by the two places
 * that show one: the `<File>` card inside a document and the app's own view of
 * a stored file. One implementation, so a card and the page it was published
 * from can never disagree about how big the same file is.
 *
 * Decimal units (kB, MB), because that is what a file manager, a browser's
 * download list and the host's own storage bill all say — the 1024-based
 * figure is right about memory and wrong about everything the reader can
 * compare it against.
 */
const UNITS = ['bytes', 'kB', 'MB', 'GB'] as const;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} bytes`;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // One decimal under 10 (2.4 MB reads better than 2 MB), none above it.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}
