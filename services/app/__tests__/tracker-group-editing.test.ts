/**
 * A TEAM TRACKER SHARED WITH A GROUP, as the skill builds and shares it, against the real app (createAppServer, real
 * tokens): new-app.mjs makes the entries dataset with the team rules, a page links it, groups.mjs shares it. A page
 * share alone never raises a member's rights on the dataset (members change only their own entries); `share
 * --datasets` also shares the linked dataset with the group at viewer, so a member changes an entry another added.
 * Signed-out visitors and signed-in strangers still change nothing; `unshare --datasets` takes it back. The tracker's
 * `save` (examples/tracker.ts, limits), run with caps.sql as each caller through the same door, holds a group's limit
 * for every reader the rules let move an entry, and moves nothing the rules refuse.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { admitGroupMember, mintAccountToken, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { createGroup } from '@/lib/groups';
import { createArtifactFromBody } from '@/lib/publish';
import { createAppServer } from '@/server/app';
import tracker from '../skills/artifactbin/examples/tracker';

useAppHarness();

const SERVER = 'http://localhost:3000';
const app = createAppServer({ webDir: 'dist/web' });
const fetcher = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(String(input), init))) as typeof fetch;
const { newAppCommand } = await import('../skills/artifactbin/scripts/new-app.mjs');
const { groupsCommand } = await import('../skills/artifactbin/scripts/groups.mjs');
type Reply = { affected?: number; rows?: Array<Record<string, unknown>>; error?: string };

/** One statement through the page's SQL door, as WHO (null: signed out). */
async function pageSql(page: string, who: { token: string } | null, sql: string, params: Record<string, unknown> = {}) {
  const response = await app.fetch(new Request(`${SERVER}/api/artifacts/${page}/sql`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: JSON.stringify({ sql, params, revision: '1' }) }));
  return { status: response.status, body: await response.json() as Reply };
}
/** caps.sql as WHO, through the page's SQL door: what tracker.ts's functions get when WHO calls them. */
const capsAs = (page: string, who: { token: string } | null) => ({ sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce((sql, part, i) => sql + (i ? `$p${i - 1}` : '') + part, '');
  const reply = await pageSql(page, who, text, Object.fromEntries(values.map((value, i) => ['p' + i, value])));
  if (reply.status !== 200) throw Error(reply.body.error);
  return reply.body;
} });
const changed = async (page: string, who: { token: string } | null, id: string, note: string) =>
  (await pageSql(page, who, 'update entries set note = :note where _id = :id', { id, note })).body.affected ?? 0;

/** A team tracker (new-app.mjs) linked by a page, a group of two members, a stranger; in DIR. */
async function teamTracker(dir: string) {
  const owner = await mintAccountToken('tracker_owner'), first = await mintAccountToken('tracker_first');
  const second = await mintAccountToken('tracker_second'), stranger = await mintAccountToken('tracker_stranger');
  const options = (token: string) => ({ env: { ARTIFACTBIN_URL: SERVER, ARTIFACTBIN_TOKEN: token,
    ARTIFACTBIN_HOME: path.join(dir, 'home') }, fetcher, retryDelays: [], cwd: dir, log: () => {} });
  const made = await newAppCommand({ values: { server: SERVER, title: 'Launch tasks', dir: 'app', without: 'collab,limits' },
    positionals: [] }, options(owner.token));
  const entries = (made.datasets as { entries: { id: string } }).entries.id;
  const created = await createArtifactFromBody({ html: `<html><head><link rel="af-dataset" data-af-name="entries" ` +
    `href="ref:${entries}"></head><body><h1>Launch tasks</h1></body></html>`, title: 'Launch tasks', visibility: 'unlisted' },
  identityForUser(owner.userId!, owner.id) as AccessActor & { tokenId: string }, SERVER);
  expect(created.status, await created.clone().text()).toBe(201);
  const page = (await created.json()).id as string;
  const group = await createGroup(owner.userId!, { handle: 'launch_crew', name: 'Launch crew' });
  for (const member of [first, second]) await admitGroupMember(owner.userId!, group.id, member.userId!, 'viewer');
  const groups = (sub: string, values: Record<string, unknown>) =>
    groupsCommand({ sub, positionals: [page], values: { server: SERVER, group: 'launch_crew', ...values } }, options(owner.token));
  return { owner, first, second, stranger, entries, page, groups };
}

it('a group a tracker is shared with --datasets edits every entry; the page share alone never grants it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-group-'));
  try {
    const { first, second, stranger, entries, page, groups } = await teamTracker(dir);

    // The page alone: the first member adds an entry; the second may not change it (the dataset says signed_in).
    expect(await groups('share', { role: 'viewer' })).toMatchObject({ changed: true });
    const added = await pageSql(page, first, "insert into entries (name, grp, note) values ('Ship it', 'To do', '')");
    expect(added.body, JSON.stringify(added.body)).toMatchObject({ affected: 1 });
    const row = (await pageSql(page, first, "select _id from entries where name = 'Ship it'")).body.rows![0]!._id as string;
    expect(await changed(page, second, row, 'page only')).toBe(0);

    // --datasets: the entries dataset is shared with the group at viewer too; the team rules now let any member edit.
    const shared = await groups('share', { role: 'viewer', datasets: true });
    expect(shared).toMatchObject({ ok: true, code: 'completed', page: { id: page, role: 'viewer' },
      datasets: [{ id: entries, name: 'entries', role: 'viewer', ok: true }] });
    expect(await changed(page, second, row, 'edited by the second member')).toBe(1);
    expect(await changed(page, null, row, 'signed out')).toBe(0);
    expect(await changed(page, stranger, row, 'a stranger')).toBe(0);
    expect((await pageSql(page, first, 'select note from entries where _id = :id', { id: row })).body.rows)
      .toEqual([{ note: 'edited by the second member' }]);

    // An editor share would let members rewrite the dataset's rules: --datasets refuses it before any write.
    await expect(groups('share', { role: 'editor', datasets: true, yes: true })).rejects.toMatchObject({ code: 'datasets_editor', exit: 2 });

    // unshare --datasets takes both back: the second member is a page reader again, changing only their own.
    expect(await groups('unshare', { datasets: true, yes: true })).toMatchObject({ ok: true,
      datasets: [{ id: entries, ok: true }] });
    expect(await changed(page, second, row, 'after unshare')).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);

it('tracker.ts save holds a group\'s limit for the owner, a --datasets member and a link holder, and widens no one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tracker-limit-'));
  try {
    const { owner, first, second, stranger, page, groups } = await teamTracker(dir);
    expect(await groups('share', { role: 'viewer', datasets: true })).toMatchObject({ ok: true });
    const add = async (who: { token: string }, name: string, grp: string) => {
      expect((await pageSql(page, who, 'insert into entries (name, grp, note) values (:name, :grp, \'\')', { name, grp })).body).toMatchObject({ affected: 1 });
      return (await pageSql(page, who, 'select _id from entries where name = :name', { name })).body.rows![0]!._id as string;
    };
    const where = async (id: string) => (await pageSql(page, owner, 'select grp from entries where _id = :id', { id })).body.rows![0]!.grp;
    const save = (who: { token: string }, id: string, name: string, grp: string) => tracker.save({ id, name, grp, note: '' }, null as never, capsAs(page, who));
    // Doing is full (five entries, tracker.ts's LIMIT); To do and Done have room.
    for (let i = 0; i < 5; i++) await add(owner, 'Busy ' + i, 'Doing');
    const mine = await add(first, 'First task', 'To do'), theirs = await add(stranger, 'Stranger task', 'To do');
    const owned = await add(owner, 'Owner task', 'To do');
    for (const [who, id, name] of [[owner, owned, 'Owner task'], [second, mine, 'First task'], [stranger, theirs, 'Stranger task']] as const) {
      // A move into the full group is refused, the entry left where it was; a group with room takes it.
      await expect(save(who, id, name, 'Doing'), name).rejects.toThrow('Doing is full (5 entries)');
      expect(await where(id)).toBe('To do');
      expect(await save(who, id, name, 'Done'), name).toMatchObject({ affected: 1 });
      expect(await where(id)).toBe('Done');
    }
    // A link holder still moves only their own entry: another's is unchanged (affected 0), never reported as full.
    expect(await save(stranger, mine, 'First task', 'To do')).toEqual({ affected: 0, returning: [] });
    expect(await where(mine)).toBe('Done');
    await expect(save(null as never, mine, 'First task', 'To do')).rejects.toThrow();
    expect(await where(mine)).toBe('Done');
    expect((await pageSql(page, owner, "select count(*) as n from entries where grp = 'Doing'")).body.rows).toEqual([{ n: 5 }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);
