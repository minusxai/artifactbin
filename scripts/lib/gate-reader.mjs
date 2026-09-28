/**
 * WHICH READER A GATE DRIVES. `GATE_READER=compiled` (a compiled leg, scripts/gates.manifest
 * COMPILED_LEGS) means the gate runs against the compiled reader: its servers boot with
 * `FLAG__COMPILED_READER=on`, and a gate also names `?reader=compiled` on the document URLs it opens, so
 * the same leg drives a `shadow` server too. Unset: today's reader.
 *
 * A check that asserts how today's React reader does something the compiled page does differently BY
 * DESIGN (docs/phase2-architecture.md) is skipped on the compiled leg with `legacyOnly`, which records
 * the reason as a passing line — never silently.
 */
export const compiledReader = process.env.GATE_READER === 'compiled';

/** A document URL as this leg opens it: `?reader=compiled` added on the compiled leg. */
export const readerUrl = (url) => (compiledReader ? `${url}${url.includes('?') ? '&' : '?'}reader=compiled` : url);

/**
 * Run `assert` on today's reader; on the compiled leg record why it does not apply.
 * @param {{ (ok: boolean, msg: string): void }} check
 * @param {string} why  what the compiled page does instead, and where that is decided
 * @param {() => void} assert
 */
export function legacyOnly(check, why, assert) {
  if (compiledReader) check(true, `compiled reader: skipped a legacy-only check — ${why}`);
  else assert();
}
