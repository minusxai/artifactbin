/**
 * THE DASHBOARD'S ACTIVITY: two short lists read off the log — what happened
 * on your artifacts, and what the people you follow did in public. One line
 * per row: who, the verb in plain words, the document (a link), when. Renders
 * NOTHING when both lists are empty; an empty section is not a feature.
 *
 * THE LOG'S WORDS ARE NOT THE PAGE'S WORDS. A row is a sentence somebody
 * reads, so the catalogue's verb is translated here and only here: `created`
 * is "published", `annotated` is "commented on". An unknown verb still reads
 * as something (underscores become spaces) rather than blanking the row — the
 * catalogue grows and this page must not have to grow with it to stay
 * legible.
 */
import { dateStamp } from '@/components/ui';
import { Activity as ActivityIcon } from 'lucide-react';
import type { FeedItem } from '@/lib/feed-wire';

/** What each verb says on a line of prose. Anything absent falls through to its own name. */
const PLAIN: Record<string, string> = {
  created: 'published',
  updated: 'updated',
  edited: 'edited',
  reverted: 'reverted',
  deleted: 'deleted',
  exported: 'exported',
  mutated: 'changed data in',
  viewed: 'viewed',
  forked: 'forked',
  liked: 'liked',
  unliked: 'unliked',
  annotated: 'commented on',
  annotation_resolved: 'resolved a comment on',
  annotation_deleted: 'deleted a comment on',
  sharing_changed: 'changed sharing on',
};
const plain = (verb: string): string => PLAIN[verb] ?? verb.replace(/_/g, ' ');

/** The rail is a glanceable digest, not an unbounded audit log. */
const VISIBLE_ACTIVITY = 10;

/**
 * COMPACT, not `ui.timeAgo`. That one narrates an owner's surface in full
 * words ("3 hrs ago") and reads correctly beside a document title on its own
 * line; a feed row already carries a handle, a verb and a title, so the stamp
 * is the one part that gets abbreviated. The handover to an absolute date is
 * the same, and it is `dateStamp` — the shared one.
 */
function since(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return dateStamp(iso);
}

/**
 * Who did it. A handle when the log has one; "someone" when the subject is a
 * visitor hash, a bare token, or an account with no username yet — the row
 * still says a person was there, which is the whole of what a view means.
 */
const who = (item: FeedItem): string => (item.subject.handle ? `@${item.subject.handle}` : 'someone');

function Row({ item, compact = false }: { item: FeedItem; compact?: boolean }) {
  // A document with no title is still a link, by its id: the row is how
  // someone GETS to it, and a titleless draft is exactly the one they may be
  // looking for.
  const name = item.object.title || item.object.id;
  return (
    <li className={`flex flex-wrap items-baseline gap-x-1.5 border-t border-edge font-sans text-muted first:border-t-0 ${compact ? 'py-2 text-xs leading-relaxed' : 'py-1.5 text-sm'}`}>
      <span className="text-fg">{who(item)}</span>{' '}
      <span>{plain(item.verb)}</span>{' '}
      <a href={`/a/${item.object.id}`} aria-label={name} className="text-accent no-underline hover:underline underline-offset-4">{name}</a>{' '}
      <span className={`ml-auto font-mono text-faint ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{since(item.at)}</span>
    </li>
  );
}

/** One titled list, or nothing at all — an empty column under a heading says only that the query ran. */
function Column({ label, items, compact = false }: { label: string; items: FeedItem[]; compact?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="min-w-0 flex-1">
      <h3 className={`mb-1 font-mono tracking-[0.14em] text-faint uppercase ${compact ? 'text-[9px]' : 'text-[10px]'}`}>{label}</h3>
      <ul className="m-0 list-none p-0">{items.map((item) => <Row key={item.id} item={item} compact={compact} />)}</ul>
    </div>
  );
}

export function ActivityFeed({ mine, following, compact = false }: { mine: FeedItem[]; following: FeedItem[]; compact?: boolean }) {
  // Export is emitted while serving an image/export response. It describes a
  // delivery mechanism, not a useful human action in this digest.
  const visibleMine = mine.filter((item) => item.verb !== 'exported');
  const visibleFollowing = following.filter((item) => item.verb !== 'exported');
  if (visibleMine.length === 0 && visibleFollowing.length === 0) return null;

  // Each feed arrives newest-first, but the ten-row budget belongs to the
  // whole section. Merge before cutting so an active followed account cannot
  // be hidden behind ten slightly older events on the owner's own artifacts.
  const recent = [
    ...visibleMine.map((item) => ({ group: 'mine' as const, item })),
    ...visibleFollowing.map((item) => ({ group: 'following' as const, item })),
  ]
    .sort((a, b) => Date.parse(b.item.at) - Date.parse(a.item.at))
    .slice(0, VISIBLE_ACTIVITY);
  const shownMine = recent.filter(({ group }) => group === 'mine').map(({ item }) => item);
  const shownFollowing = recent.filter(({ group }) => group === 'following').map(({ item }) => item);
  const hidden = visibleMine.length + visibleFollowing.length - recent.length;

  return (
    <section aria-label="Activity" data-layout={compact ? 'rail' : 'page'} className={`reveal ${compact ? 'mt-8 border-t border-edge pt-6' : 'mt-10'}`}>
      <h2 className={`mb-3 flex items-center gap-1.5 font-mono font-semibold text-fg ${compact ? 'text-xs' : 'text-sm tracking-[0.14em] uppercase'}`}>
        <ActivityIcon aria-hidden="true" className="size-3 stroke-[1.8] text-accent" />
        Activity
      </h2>
      <div className={`flex flex-col ${compact ? 'gap-5' : 'gap-6 sm:flex-row'}`}>
        <Column label="on your artifacts" items={shownMine} compact={compact} />
        <Column label="from people you follow" items={shownFollowing} compact={compact} />
      </div>
      {hidden > 0 && (
        <p aria-label={`${hidden} more activity events`} className="mt-3 border-t border-edge pt-2 font-mono text-[10px] text-faint">
          + {hidden} more
        </p>
      )}
    </section>
  );
}

export default ActivityFeed;
