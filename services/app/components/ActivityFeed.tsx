/**
 * THE DASHBOARD'S ACTIVITY: two short lists read off the log — what happened
 * on your artifacts, and what the people you follow did in public. One line
 * per row: who, the verb in plain words, the document (a link), when. Renders
 * NOTHING when both lists are empty; an empty section is not a feature.
 */
import type { FeedItem } from '@/lib/feed-wire';

export function ActivityFeed(props: { mine: FeedItem[]; following: FeedItem[] }) {
  void props;
  return null; // events-moments: implement
}
