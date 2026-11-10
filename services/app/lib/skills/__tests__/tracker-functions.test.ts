/**
 * The tracker's backend functions (skills/artifactbin/examples/tracker.ts): `me` says who reads, from the principal
 * alone; `add` and `save` (limits) check the entry, then write through ONE caps.sql statement that holds the limit (the
 * count and the insert or update together: concurrency is pinned in __tests__/page-sql-door.test.ts), as the caller,
 * so the dataset rules still stamp and decide (__tests__/tracker-group-editing.test.ts runs them on the real rules).
 * `add` says a group is full when the insert added nothing; `save` says so only when the entry is there, in another
 * group, and the group it moves to is full. The file publishes as a function file: its callable names and roles are
 * what publish reads from its source.
 */
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import tracker, {roles} from '../../../skills/artifactbin/examples/tracker';
import {functionFileSurface} from '@/lib/page-operations';

type Call = {text: string; values: unknown[]};
/** caps.sql as the tagged template it is: the text with $pN for each value, and the values; ANSWER answers it. */
const probe = (answer: (call: Call) => unknown) => {
  const calls: Call[] = [];
  return {calls, caps: {sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = {text: strings.reduce((sql, part, i) => sql + (i ? `$p${i - 1}` : '') + part, ''), values};
    calls.push(call);
    return answer(call);
  }}};
};
/** caps.sql over a group already holding `inGroup` entries: the capped insert adds one only below the limit. */
const caps = (inGroup: number) => probe(({values}) =>
  inGroup < Number(values.at(-1)) ? {affected: 1, returning: [{_id: 'row-9'}]} : {affected: 0, returning: []});
/** caps.sql over one entry in group `was` (null: gone), the target group holding `size`, and whether the rules let the
 *  caller change the entry: the capped update changes it only when it stays in its group or the target has room. */
const entries = ({was, size, mayChange = true}: {was: string | null; size: number; mayChange?: boolean}) => probe(({text, values}) => {
  if (text.startsWith('select')) return {columns: [{name: 'was'}, {name: 'size'}], rows: [{was, size}]};
  const [grp, limit] = [values[4], Number(values[6])];
  return mayChange && was !== null && (was === grp || size < limit) ? {affected: 1, returning: [{_id: 'row-1'}]} : {affected: 0, returning: []};
});
const INSERT = 'insert into entries (name, grp, note) select $p0, $p1, $p2\n   where (select count(*) from entries where grp = $p3) < $p4';
const UPDATE = 'update entries set name = $p0, grp = $p1, note = $p2\n   where _id = $p3\n   and (grp = $p4 or (select count(*) from entries where grp = $p5) < $p6)';
const LOOKUP = 'select (select grp from entries where _id = $p0) as was,\n   count(*) as size from entries where grp = $p1';
const reader = {subject: 'usr_1', role: 'signed_in'};

it('adds an entry while its group has room, in one capped insert, every value bound', async () => {
  const probe = caps(4);
  expect(await tracker.add({name: ' Ship it ', grp: ' To do ', note: ' soon '}, reader, probe.caps)).toEqual({affected: 1, returning: [{_id: 'row-9'}]});
  expect(probe.calls).toEqual([{text: INSERT, values: ['Ship it', 'To do', 'soon', 'To do', 5]}]);
});

it('says a group is full, naming it and the limit, when the capped insert added nothing', async () => {
  const probe = caps(5);
  await expect(tracker.add({name: 'One more', grp: 'To do'}, reader, probe.caps)).rejects.toThrow('To do is full (5 entries)');
  expect(probe.calls).toEqual([{text: INSERT, values: ['One more', 'To do', '', 'To do', 5]}]);
});

it('saves an edit or a move into a group with room in one capped update, every value bound', async () => {
  const probe = entries({was: 'Doing', size: 4});
  expect(await tracker.save({id: ' row-1 ', name: ' Ship it ', grp: ' To do ', note: ' soon '}, reader, probe.caps)).toEqual({affected: 1, returning: [{_id: 'row-1'}]});
  expect(probe.calls).toEqual([{text: UPDATE, values: ['Ship it', 'To do', 'soon', 'row-1', 'To do', 'To do', 5]}]);
  // An edit that keeps its group passes the limit, even in a full group.
  const kept = entries({was: 'To do', size: 5});
  expect(await tracker.save({id: 'row-1', name: 'Renamed', grp: 'To do'}, reader, kept.caps)).toMatchObject({affected: 1});
  expect(kept.calls).toHaveLength(1);
});

it('says a group is full when a move into it changed nothing, and the entry is there, in another group', async () => {
  const probe = entries({was: 'Doing', size: 5});
  await expect(tracker.save({id: 'row-1', name: 'Mover', grp: 'To do'}, reader, probe.caps)).rejects.toThrow('To do is full (5 entries)');
  expect(probe.calls).toEqual([{text: UPDATE, values: ['Mover', 'To do', '', 'row-1', 'To do', 'To do', 5]}, {text: LOOKUP, values: ['row-1', 'To do']}]);
});

it('answers a save the rules refused, or of a removed entry, with affected 0, never as a full group', async () => {
  const none = {affected: 0, returning: []};
  expect(await tracker.save({id: 'row-1', name: 'Theirs', grp: 'To do'}, reader, entries({was: 'Doing', size: 2, mayChange: false}).caps)).toEqual(none);
  expect(await tracker.save({id: 'row-1', name: 'Gone', grp: 'To do'}, reader, entries({was: null, size: 5}).caps)).toEqual(none);
});

it('refuses a bad entry before counting or writing anything, a non-string input included', async () => {
  for (const input of [{name: '', grp: 'To do'}, {name: 'x'.repeat(81), grp: 'To do'}, {name: 'Ok', grp: ' '}, {name: 'Ok', grp: 'To do', note: 'n'.repeat(141)}, {name: 7, grp: 'To do'}]) {
    const probe = caps(0);
    await expect(tracker.add(input, reader, probe.caps)).rejects.toThrow('Give the entry a name');
    await expect(tracker.save({id: 'row-1', ...input}, reader, probe.caps)).rejects.toThrow('Give the entry a name');
    expect(probe.calls).toEqual([]);
  }
  const probe = caps(0);
  for (const id of [undefined, ' ', 7]) await expect(tracker.save({id, name: 'Ok', grp: 'To do'}, reader, probe.caps)).rejects.toThrow('Name the entry to save');
  expect(probe.calls).toEqual([]);
});

it('says who reads from the principal alone', () => {
  expect(tracker.me({}, {subject: 'usr_1', role: 'viewer'})).toEqual({signedIn: true, id: 'usr_1', role: 'viewer'});
  expect(tracker.me({}, {subject: null, role: 'anonymous'})).toEqual({signedIn: false, id: null, role: 'anonymous'});
});

it('publishes as a function file: me for anyone who reads, add and save for signed-in readers, no GraphQL', async () => {
  const source = readFileSync(new URL('../../../skills/artifactbin/examples/tracker.ts', import.meta.url), 'utf8');
  expect(await functionFileSurface(source)).toEqual({functions: {me: 'anonymous', add: 'signed_in', save: 'signed_in'}, schedule: null});
  expect(roles).toEqual({add: 'signed_in', save: 'signed_in'});
  expect(source).not.toMatch(/typeDefs|caps\.query|_aggregate/);
});
