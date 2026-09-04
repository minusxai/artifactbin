/**
 * THE FEED, AS A PAGE SEES IT — one envelope decorated with the two names a
 * row needs to read as a sentence: the subject's public handle and the
 * artifact's title. Types only, with no imports, because the web bundle and
 * the reader (lib/feed) both name this shape and only one of them may touch
 * the database.
 */
export type FeedSubjectKind = 'user' | 'token' | 'visitor';

export interface FeedItem {
  id: string;
  /** ISO timestamp. */
  at: string;
  verb: string;
  subject: { kind: FeedSubjectKind | null; id: string | null; handle: string | null };
  object: { kind: string; id: string; title: string | null };
  payload: Record<string, unknown>;
}
