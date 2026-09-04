/**
 * HOW A FILE IS PRESENTED TO A PERSON — its size and its name. Pure, and shared
 * by every surface that shows a file: the `<File>` card inside a document, the
 * app's own view of a stored one, and the `Content-Disposition` name on
 * `/assets/<hash>`. One implementation, so two surfaces can never disagree
 * about the same file.
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

/**
 * The name a URL implies — its last path segment, decoded, without the query or
 * the fragment. Null when there is no segment to name.
 *
 * THE DECODE MUST NOT THROW, and that is the whole reason this is a function
 * rather than a line at each call site. `decodeURIComponent` raises `URIError`
 * on a lone `%`, and `50%off.pdf`, `100%.pdf` and `a%ff.pdf` are ordinary
 * filenames — not crafted input. Found in review: one of them in a `<File src>`
 * published a document (the import failed, which is a WARNING by design) that
 * then answered 500 to every reader, because the card derived its name during
 * SSR; the same line made `/assets/<hash>` 500 for a PDF that had imported
 * perfectly. A malformed escape is therefore kept AS TEXT: a filename is
 * decoration, and no decoration is worth an outage.
 */
export function fileNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Parsed rather than split on '/': splitting reads the HOST of
  // `https://x.test/` as the filename, which the test above caught. A relative
  // address is resolved against a throwaway base so both shapes take one path.
  let path: string;
  try {
    path = new URL(url, 'https://relative.invalid').pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const last = path.split('/').filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
