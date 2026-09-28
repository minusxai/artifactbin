/**
 * WHICH RENDERER ANSWERS A DOCUMENT REQUEST (docs/phase2-architecture.md §10).
 *
 * The deployment's switch (`FLAG__COMPILED_READER`, lib/config COMPILED_READER)
 * says what readers get; a request's `?reader=` may pick the other path only
 * when the switch is not `off` — a gate compares both, a bug report escapes
 * to legacy — and never on a custom-domain post, where every URL switch is
 * ignored (app/a/[id]/raw DomainPost). Pure.
 */
import { COMPILED_READER_FLAGS, READER_MODE_PARAM, type CompiledReaderFlag, type ReaderMode } from './contract';

/** The flag's value from its setting text; anything unknown is `off` (a typo must never turn a reader path on). */
export function parseCompiledReaderFlag(value: string | undefined): CompiledReaderFlag {
  const flag = (value ?? '').trim().toLowerCase();
  return (COMPILED_READER_FLAGS as readonly string[]).includes(flag) ? (flag as CompiledReaderFlag) : 'off';
}

/**
 * The mode for one request.
 *  - `off`: legacy, whatever the request says.
 *  - `shadow`: legacy unless `?reader=compiled`.
 *  - `on`: compiled unless `?reader=legacy`.
 * `search` is the request's query string (`URL.search`); `domainPost` ignores it.
 */
export function readerModeFor(flag: CompiledReaderFlag, search: string, options: { domainPost?: boolean } = {}): ReaderMode {
  if (flag === 'off') return 'legacy';
  const asked = options.domainPost ? null : new URLSearchParams(search).get(READER_MODE_PARAM);
  if (asked === 'compiled') return 'compiled';
  if (asked === 'legacy') return 'legacy';
  return flag === 'on' ? 'compiled' : 'legacy';
}

/** Whether this deployment compiles and stores pages at all (shadow and on both do; off compiles nothing). */
export const compilesPages = (flag: CompiledReaderFlag): boolean => flag !== 'off';
