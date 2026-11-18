/**
 * WHERE A DATA COMPONENT'S ROWS CAME FROM, in words: the one vocabulary `<af-chart>` and `<af-data-table>` label
 * themselves with. It is derived only from the `source` the page SQL door puts on a read's answer (contracts
 * sql-source, kept on the rows as `rows.source`), never from page markup, so rows a page writes itself get no label.
 *
 *   Live              read live as the reader (a dot in the label)
 *   Live · paused     live data waiting for the reader to allow it (the read failed `consent_required`)
 *   Snapshot · <when> stored rows, with when they were stored
 *
 * Several sources (a mix of live and stored) read Live and name the stored part in the tooltip. A replayed answer
 * would be one more kind, `cached` ("Cached · N min ago"): add it to `SqlSourceKind` and a case below.
 */
import type { SqlAnswerSource } from '@artifactbin/contracts/sql-source';

type DataSourceState = 'live' | 'paused' | 'snapshot';
export interface DataSourceLabel { state: DataSourceState; text: string; tooltip: string; name: string }

const KINDS = new Set(['live', 'snapshot']);
/** The source `value` (an answer's rows, or an object carrying `source`) names, or null. */
export function sourceOf(value: unknown): SqlAnswerSource | null {
  const source = (value as { source?: unknown } | null | undefined)?.source as Partial<SqlAnswerSource> | undefined;
  if (!source || typeof source !== 'object' || !KINDS.has(source.kind as string)) return null;
  if (typeof source.at !== 'string' || Number.isNaN(Date.parse(source.at))) return null;
  const names = Array.isArray(source.names) ? source.names.filter((n): n is string => typeof n === 'string') : [];
  return { kind: source.kind!, at: source.at, ...(names.length ? { names } : {}) };
}

const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const day = (at: string) => new Date(at).toLocaleString(undefined,
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const label = (state: DataSourceState, text: string, tooltip: string): DataSourceLabel =>
  ({ state, text, tooltip, name: `Data source: ${text}` });
const latest = (sources: readonly SqlAnswerSource[]) => sources.map((s) => s.at).sort().at(-1)!;
const names = (sources: readonly SqlAnswerSource[]) =>
  [...new Set(sources.flatMap((s) => s.names ?? []))].join(', ');

/**
 * The label for a component's sources, or null for none. `failure` is the code of the read that failed, if one did:
 * `consent_required` reads paused whatever was shown before; any other failure says nothing about the source.
 */
export function sourceLabel(sources: readonly (SqlAnswerSource | null | undefined)[],
  failure?: string | null): DataSourceLabel | null {
  if (failure === 'consent_required') {
    return label('paused', 'Live · paused', 'Live data is paused until you allow it.');
  }
  if (failure) return null;
  const known = sources.filter((s): s is SqlAnswerSource => !!s);
  const live = known.filter((s) => s.kind === 'live'), stored = known.filter((s) => s.kind === 'snapshot');
  if (live.length) {
    const part = stored.length
      ? ` ${names(stored) || 'Part of it'}: stored data, captured ${day(latest(stored))}.` : '';
    return label('live', 'Live', `Read live as you at ${time(latest(live))}.${part}`);
  }
  if (!stored.length) return null;
  const which = names(stored);
  return label('snapshot', `Snapshot · ${day(latest(stored))}`,
    `Stored data${which ? ` (${which})` : ''}, captured ${day(latest(stored))}.`);
}
