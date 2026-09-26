/**
 * THE BUILT-INS: every name a document reads without declaring it. One list,
 * read by the compiler (what a statement may bind and join), the markup
 * validator (where `$_me.id` may sit), the server (what it supplies on every
 * run and every write) and the runtime (what it hands the view).
 *
 * Every built-in starts with `_`, which no declaration may (dataflow
 * `checkName`), and every one is read-only: no control, link, script or
 * `set=` can write it. Two kinds of supplier:
 *  - the PLATFORM supplies `_me.id`, `_now` and `_tz` identically on the
 *    server and in the browser (the reader's zone travels with the request);
 *  - the CONTROL that runs a mutation supplies `_row.<column>` (the row it sits
 *    in) and `_value` (the new value an editing cell holds).
 */
import { MEMBER_COLUMNS, type ColumnType, type DatasetColumn } from '@artifactbin/contracts';
import type { BuiltinInput, BuiltinTable } from './compiled-dataflow';

export interface BuiltinInputSpec {
  /** As written after `$`; `_row` stands for every `_row.<column>`. */
  name: '_me.id' | '_now' | '_tz' | '_value' | '_row';
  /** Null: typed where it is used — `_value` by the edited column, `_row.x` by the row's table. */
  type: ColumnType | null;
  source: 'platform' | 'control';
  /** Built-ins are never written — not by a control, a link, a script or `set=`. */
  readOnly: true;
  /** A `<Query>` may bind it (a control input exists only when a control runs a write). */
  query: boolean;
  /** Markup may read it (a condition, `<User userId>`). */
  markup: boolean;
  summary: string;
}

export const BUILTIN_INPUTS: readonly BuiltinInputSpec[] = [
  { name: '_me.id', type: 'user', source: 'platform', readOnly: true, query: true, markup: true, summary: "The reader's account id; null for a guest." },
  { name: '_now', type: 'timestamp', source: 'platform', readOnly: true, query: true, markup: false, summary: 'The current instant, UTC ISO; the same on the server and in the browser.' },
  { name: '_tz', type: 'string', source: 'platform', readOnly: true, query: true, markup: false, summary: "The reader's IANA time zone (UTC when unknown)." },
  { name: '_row', type: null, source: 'control', readOnly: true, query: false, markup: false, summary: 'A field of the row the control sits in: $_row.<column>.' },
  { name: '_value', type: null, source: 'control', readOnly: true, query: false, markup: false, summary: 'The new value an editing cell holds.' },
];

export const BUILTIN_TABLES: Readonly<Record<BuiltinTable, { columns: DatasetColumn[]; summary: string }>> = {
  _me: { columns: [{ name: 'id', type: 'user' }], summary: 'The reader as a one-row table (id null for a guest).' },
  _members: { columns: MEMBER_COLUMNS, summary: "The artifact's accepted members." },
};

const ROW_FIELD = /^_row\.([A-Za-z_]\w*)$/;

/** The spec for a logical built-in input (`_row.day` → the `_row` spec), or null. */
export function builtinInput(logical: string): BuiltinInputSpec | null {
  const name = ROW_FIELD.test(logical) ? '_row' : logical;
  return BUILTIN_INPUTS.find((b) => b.name === name) ?? null;
}

/** `_row.day` → `day`; anything else → null. */
export const rowField = (logical: string): string | null => ROW_FIELD.exec(logical)?.[1] ?? null;

export const isBuiltinInput = (logical: string): logical is BuiltinInput => builtinInput(logical) !== null;
export const isBuiltinTable = (name: string): name is BuiltinTable => Object.hasOwn(BUILTIN_TABLES, name);

/** `_me`, the viewer: bare, it is a row; its field is `_me.id`. */
export const VIEWER = '_me';
export const VIEWER_ID: BuiltinInput = '_me.id';

/** Names a declaration may not take: `_` belongs to the built-ins, `ref_` to the removed dataset-table syntax. */
export const reservedDeclarationName = (name: string): string | null =>
  name.startsWith('_') ? 'names beginning with _ belong to the built-ins ($_me.id, $_now, $_row.<column>)'
    : name.startsWith('ref_') ? 'ref_<id> once named a dataset table; read a dataset through <Import>'
      : name.includes('__') ? 'a double underscore is how SQL spells a built-in field ($_me.id binds as $_me__id)'
        : null;

/**
 * The attribute positions that only READ their reference — where a built-in
 * markup input (`$_me.id`) may sit. Deliberately tiny and opt-in: a binding
 * position added later must not silently become a place a built-in is written.
 */
export const READ_ONLY_REF_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  User: new Set(['userId']), UserImage: new Set(['userId']), UserHandle: new Set(['userId']),
};

/** What the platform supplies to every run: the viewer, the instant and the zone. */
export interface PlatformInputs { userId: string | null; now: string; tz: string }

/** The platform's built-ins as logical values. */
export const platformValues = (p: PlatformInputs): Record<'_me.id' | '_now' | '_tz', string | null> =>
  ({ '_me.id': p.userId, _now: p.now, _tz: p.tz });

/** The built-in tables as rows. */
export const builtinTableRows = (p: { userId: string | null; members: Array<Record<string, unknown>> }): Record<BuiltinTable, Array<Record<string, unknown>>> =>
  ({ _me: [{ id: p.userId }], _members: p.members });

/** A reader's zone as the platform accepts it: a real IANA name, else UTC. */
export function readerZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

/** The zone of whoever is running this code — what the runtime sends as `$_tz`. */
export function localZone(): string {
  try { return readerZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return 'UTC'; }
}
