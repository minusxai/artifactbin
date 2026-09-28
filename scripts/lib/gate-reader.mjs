/** Every reader gate now drives the compiled page. */
export const compiledReader = true;
/** The reader no longer has a mode query parameter. */
export const readerUrl = (url) => url;
/** Record why a check of the removed React reader does not apply. */
export function legacyOnly(check, why) {
  check(true, `compiled reader: skipped a legacy-only check — ${why}`);
}
