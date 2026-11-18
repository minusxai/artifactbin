/**
 * A FAILED READ AS A COMPONENT SHOWS IT (`<af-chart>`, `<af-data-table>`): the page runtime's SqlError, or any error, as
 * `{code, message, detail}`. `code` is from contracts sql-failures (else `unexpected`); `message` is the reader's
 * sentence when the error carries one (its message differs from its detail), else its text after `prefix`; `detail`
 * is what to fix. A component's own refusal of what it was given takes a code from the same list (`failureOf`). A
 * failed component carries the code as `data-af-error` (`markFailure`; null clears it), and the failure as an event.
 */
import type { SqlFailureCode } from '@artifactbin/contracts/sql-failures';

export interface ReadFailure { code: string; message: string; detail: string }

export function readFailure(e: unknown, prefix = ''): ReadFailure {
  const error = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown; detail?: unknown };
  const said = typeof error.message === 'string' && error.message ? error.message : typeof e === 'string' && e ? e : 'Unable to load rows';
  const detail = typeof error.detail === 'string' ? error.detail : said;
  return { code: typeof error.code === 'string' && error.code ? error.code : 'unexpected', message: detail !== said ? said : prefix + said, detail };
}

/** Mark `el` failed with `failure` (null: not failed), and tell the page with `event` when it failed. */
export function markFailure(el: Element, failure: ReadFailure | null, event?: string): void {
  if (!failure) return el.removeAttribute('data-af-error');
  el.setAttribute('data-af-error', failure.code);
  if (event) el.dispatchEvent(new CustomEvent(event, { bubbles: true, detail: failure }));
}

const ownFailure = (code: SqlFailureCode, text: string): ReadFailure => ({ code, message: text.charAt(0).toUpperCase() + text.slice(1), detail: text });
/** A failure, or a component's own problem with what it was given as text (validation_failed). */
export const failureOf = (problem: ReadFailure | string): ReadFailure => (typeof problem === 'string' ? ownFailure('validation_failed', problem) : problem);
