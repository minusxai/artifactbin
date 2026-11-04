/**
 * Internal: what a comment write sends besides its route: the comment text (--body inline or
 * --body-file) and the thread revision a state change or an edit carries, read from the page's
 * threads when --expected-revision is omitted.
 * Used by: comment.mjs, comment-reactions-toolbox tests.
 */
import {readFile} from 'node:fs/promises';
import {ToolError} from './toolbox-client.mjs';

/** The comment text: --body TEXT or the contents of --body-file FILE, nonblank. */
export async function commentText(values) {
  if (values.body !== undefined && values['body-file'] !== undefined)
    throw new ToolError('invalid_invocation', 'Use --body or --body-file, not both.', 2);
  if (values.body === undefined && values['body-file'] === undefined)
    throw new ToolError('missing_body', '--body TEXT (or --body-file FILE) is required.', 2,
      'Pass the comment text inline: --body "…".');
  const text = values.body ?? (await readFile(values['body-file'], 'utf8'));
  if (!text.trim()) throw new ToolError('empty_body', 'Comment text must be nonblank.', 2);
  return text;
}

/** The current revision of the thread that holds `comment` (its root or one of its replies). */
export async function threadRevision(client, id, comment) {
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({status: 'all', limit: '100', ...(cursor ? {cursor} : {})});
    const listed = await client.request(`/api/artifacts/${id}/annotations?${query}`);
    for (const thread of listed?.annotations ?? [])
      if (thread.id === comment || thread.thread?.some(item => item.id === comment))
        return thread.revision;
    cursor = listed?.next_cursor;
    if (!cursor) break;
  }
  throw new ToolError('comment_not_found', `Page ${id} has no comment ${comment}.`, 3,
    `List its threads with node scripts/comment.mjs list ${id} --status all.`);
}
