import { expect, it } from 'vitest';
import { request, setSession, useAppHarness } from './harness';
import { GET } from '@/app/api/my/people/route';
import { membershipInbox, updateMembershipInbox } from '@/lib/document-data';
import { getDb, measureQueries } from '@/lib/platform';
import { RECIPIENT, inboxVolumeBase, seedInboxVolume } from './inbox-volume';

useAppHarness();
const actor = { userId: RECIPIENT.id, tokenId: null, email: RECIPIENT.email };

/**
 * The seed's rules, restated independently of the inbox: which notifications the recipient may see.
 * Access kinds rotate by i%6 (0 unlisted, 1 named commenter share, 2 group viewer, 3 none, 4 public
 * commenter link, 5 own); comments need a commenter role, mutations an explicit accepted join and
 * readable sources.
 */
function expectedInbox(from: number, to: number) {
  const items: Array<{ id: string; at: number; unread: boolean }> = [];
  const minute = 60_000, base = Date.parse('2026-02-01T00:00:00Z');
  for (let i = from; i <= to; i++) {
    const at = base + i * 3 * minute, blocked = i % 13 === 0, live = i % 17 !== 0, kind = i % 6;
    const readable = live && !blocked && kind !== 3;
    if (readable && i % 7 !== 0 && [1, 4, 5].includes(kind)) items.push({ id: `vol-c${i}`, at, unread: i % 3 !== 0 });
    if (readable && i % 8 !== 0) items.push({ id: `vol-m${i}`, at: at + minute, unread: true });
    if (i % 5 === 0 && !blocked) items.push({ id: `vol-f${i}`, at, unread: true });
    if (readable && i % 10 !== 8 && i % 10 !== 9 && i % 9 !== 0) items.push({ id: `vol-n${i}`, at: at + 2 * minute, unread: i % 4 !== 0 });
  }
  items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return { ids: items.map((item) => item.id), unread: items.filter((item) => item.unread).length };
}

async function allPages() {
  const ids: string[] = [];
  let offset: number | null = 0, unread = -1;
  while (offset !== null) {
    const page = await membershipInbox(actor, offset);
    ids.push(...page.notifications.map((n) => n.id));
    unread = page.unread;
    offset = page.next;
  }
  return { ids, unread };
}

it('decides every access path, block, deletion and ordering the way the seed states', async () => {
  const db = await getDb(), base = await inboxVolumeBase(db);
  await seedInboxVolume(db, base, 1, 150);
  expect(await allPages()).toEqual(expectedInbox(1, 150));
  // Deciding a conversation's commenter role stamps the named share on the account (share
  // resolution); shares whose conversations never reach that decision stay unresolved.
  const unresolved = (await db.query<{ artifact_id: string }>('SELECT artifact_id FROM artifact_shares WHERE user_id IS NULL')).rows.map((row) => row.artifact_id).sort();
  expect(unresolved).toEqual(Array.from({ length: 150 }, (_, i) => i + 1).filter((i) => i % 6 === 1 && (i % 7 === 0 || i % 13 === 0 || i % 17 === 0)).map((i) => `vol-a${i}`).sort());
});

it('reads the inbox in a number of statements that does not grow with its notifications', async () => {
  const db = await getDb(), base = await inboxVolumeBase(db);
  await seedInboxVolume(db, base, 1, 30);
  const small = await measureQueries(() => membershipInbox(actor));
  await seedInboxVolume(db, base, 31, 150);
  const large = await measureQueries(() => membershipInbox(actor));
  expect(large.value.unread).toBeGreaterThan(small.value.unread * 3);
  expect(large.stats.count).toBe(small.stats.count);
});

it('marks everything read with one event per notification in a number of statements that does not grow with them', async () => {
  const db = await getDb(), base = await inboxVolumeBase(db);
  const readAll = async () => {
    await db.query('DELETE FROM event_outbox');
    const { value, stats } = await measureQueries(() => updateMembershipInbox(actor, { readAll: true }));
    const events = (await db.query<{ notification_id: string; change: string }>("SELECT envelope->'payload'->>'notification_id' AS notification_id,envelope->'payload'->>'change' AS change FROM event_outbox WHERE envelope->>'verb'='notification_changed'")).rows;
    return { value, stats, events };
  };
  const unreadIds = async () => (await db.query<{ id: string }>('SELECT id FROM member_notifications WHERE recipient_id=$1 AND (seen_revision<revision OR read_at IS NULL) UNION ALL SELECT id FROM mutation_notifications WHERE recipient_id=$1 AND (seen_revision<revision OR read_at IS NULL)', [RECIPIENT.id])).rows.map((row) => row.id).sort();
  await seedInboxVolume(db, base, 1, 30);
  let expected = await unreadIds();
  const small = await readAll();
  expect(small.value.unread).toBe(0);
  expect(small.events.map((e) => e.notification_id).sort()).toEqual(expected);
  expect(new Set(small.events.map((e) => e.change))).toEqual(new Set(['read']));
  await seedInboxVolume(db, base, 31, 150);
  expected = await unreadIds();
  const large = await readAll();
  expect(large.events.map((e) => e.notification_id).sort()).toEqual(expected);
  expect(large.events.length).toBeGreaterThan(small.events.length * 3);
  expect(large.stats.count).toBe(small.stats.count);
});

it('reports total and database time on the inbox route', async () => {
  const db = await getDb(), base = await inboxVolumeBase(db);
  await seedInboxVolume(db, base, 1, 30);
  setSession({ user: { id: RECIPIENT.id, email: RECIPIENT.email } });
  const response = await GET(request('/api/my/people?offset=0'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Server-Timing')).toMatch(/^total;dur=\d+\.\d, db;dur=\d+\.\d;desc="\d+ queries"$/);
  expect((await response.json()).notifications.map((n: { id: string }) => n.id)).toEqual(expectedInbox(1, 30).ids.slice(0, 50));
  setSession(null);
  const anonymous = await GET(request('/api/my/people'));
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('Server-Timing')).toMatch(/^total;dur=/);
});
