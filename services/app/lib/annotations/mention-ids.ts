import type { MarkdownNode } from '@/lib/markdown/display';
import { parse } from '@/lib/markdown/parse';
import { personMentionId } from '@/lib/document';

/**
 * The people a comment body mentions (`/api/people/<id>` links, or the stored `/people/<id>` form), each once, in
 * order: every link lib/markdown's parser reads in the body (as the thread shows it, images on), wherever it sits:
 * paragraphs, headings, lists, quotes and table cells. Text inside code is never a link, so a mention written in
 * code invites nobody. Pure (no database), for the server's mention scan (./saved-mentions).
 */
export function mentionIds(body: string): string[] {
  const ids = new Set<string>();
  const walk = (node: MarkdownNode) => {
    for (const mark of node.marks ?? []) {
      const id = mark.type === 'link' ? personMentionId(mark.attrs?.href ?? '') : null;
      if (id) ids.add(id);
    }
    node.content?.forEach(walk);
  };
  walk(parse(body, { images: true }));
  return [...ids];
}
