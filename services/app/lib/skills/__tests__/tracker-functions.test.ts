/**
 * The tracker's backend functions (skills/artifactbin/examples/tracker.ts): `me` says who reads, from the principal
 * alone; `add` (limits) checks the entry, then inserts through ONE caps.sql statement that holds the limit (the count
 * and the insert together: concurrency is pinned in __tests__/page-sql-door.test.ts), as the caller, so the dataset
 * rules still stamp and decide, and says a group is full when the insert added nothing. The file
 * publishes as a function file: its callable names and roles are what publish reads from its source.
 */
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import tracker, {roles} from '../../../skills/artifactbin/examples/tracker';
import {functionFileSurface} from '@/lib/page-operations';

type Call = {text: string; values: unknown[]};
/** caps.sql as the tagged template it is: the text with $pN for each value, and the values. */
/** caps.sql over a group already holding `inGroup` entries: the capped insert adds one only below the limit. */
const caps = (inGroup: number) => {
  const calls: Call[] = [];
  return {calls, caps: {sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((sql, part, i) => sql + (i ? `$p${i - 1}` : '') + part, '');
    calls.push({text, values});
    return inGroup < Number(values.at(-1)) ? {affected: 1, returning: [{_id: 'row-9'}]} : {affected: 0, returning: []};
  }}};
};
const INSERT = 'insert into entries (name, grp, note) select $p0, $p1, $p2\n   where (select count(*) from entries where grp = $p3) < $p4';
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

it('refuses a bad entry before counting or writing anything, a non-string input included', async () => {
  for (const input of [{name: '', grp: 'To do'}, {name: 'x'.repeat(81), grp: 'To do'}, {name: 'Ok', grp: ' '}, {name: 'Ok', grp: 'To do', note: 'n'.repeat(141)}, {name: 7, grp: 'To do'}]) {
    const probe = caps(0);
    await expect(tracker.add(input, reader, probe.caps)).rejects.toThrow('Give the entry a name');
    expect(probe.calls).toEqual([]);
  }
});

it('says who reads from the principal alone', () => {
  expect(tracker.me({}, {subject: 'usr_1', role: 'viewer'})).toEqual({signedIn: true, id: 'usr_1', role: 'viewer'});
  expect(tracker.me({}, {subject: null, role: 'anonymous'})).toEqual({signedIn: false, id: null, role: 'anonymous'});
});

it('publishes as a function file: me for anyone who reads, add for signed-in readers, no GraphQL', async () => {
  const source = readFileSync(new URL('../../../skills/artifactbin/examples/tracker.ts', import.meta.url), 'utf8');
  expect(await functionFileSurface(source)).toEqual({functions: {me: 'anonymous', add: 'signed_in'}, schedule: null});
  expect(roles).toEqual({add: 'signed_in'});
  expect(source).not.toMatch(/typeDefs|caps\.query|_aggregate/);
});
