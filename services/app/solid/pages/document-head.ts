/**
 * WHICH VERSION THE DOCUMENT PAGE SHOWS, and so its title and the edit id new comments are made against.
 *
 * The page loads one HTML version; the frame may draw newer ones in place (`show`), and the live stream announces
 * each with its title (`published`). A rename here holds until a newer version names the page again. Comments,
 * screenshots and their images are made against the newest head shown: the id the page loaded with is a version the
 * frame may no longer show, and the server refuses an image staged against it. The browser tab follows the title.
 *
 * Interface: `createDocumentHead({ served, archivedVersion, surface, live })` → `{ html, show, published, renamed, title,
 * version, editId }`.
 */
import { createEffect, createSignal } from 'solid-js';
import { rowTitle } from '@/lib/document/display-title';

type Titled = { title?: string | null; heading?: string | null };
type LiveHead = Titled & { version?: number; editId?: string };

export function createDocumentHead(options: {
  /** The version and edit id the server rendered. */
  served: { version: number; editId: string };
  /** An archived version being read (it never moves). */
  archivedVersion: number | undefined;
  surface: (Titled & { heading?: string | null }) | undefined;
  live: () => LiveHead | null;
}) {
  const [html, show] = createSignal(options.served);
  /** The title the newest announced version carries (an HTML page's stream pings name it, create-live-artifact). */
  const [publishedTitle, setPublishedTitle] = createSignal<{ title: string | null; version: number } | null>(null);
  const [renamedTitle, setRenamedTitle] = createSignal<{ title: string; version: number } | null>(null);
  const version = () => options.archivedVersion ?? options.live()?.version ?? html().version;
  const title = () => {
    const local = renamedTitle(), published = publishedTitle();
    const heading = options.live()?.heading ?? options.surface?.heading;
    if (local && version() <= local.version && (!published || published.version <= local.version)) return rowTitle({ title: local.title, heading });
    // An HTML page's stream names each new version (a doc renames itself from its heading as it saves).
    return published ? rowTitle({ title: published.title, heading }) : rowTitle(options.live() ?? options.surface ?? {});
  };
  createEffect(() => { document.title = title(); });
  return {
    /** The HTML version this page and its frame show: the served one, then each the frame drew in place. */
    html,
    show,
    published: (title: string | null, version: number) => setPublishedTitle({ title, version }),
    renamed: (title: string) => setRenamedTitle({ title, version: version() }),
    title,
    version,
    /** The newest edit id of the version loaded and the version the live stream drew. */
    editId: () => {
      const loaded = html(), drawn = options.live();
      return drawn?.editId && (drawn.version ?? -1) > (loaded.editId ? loaded.version : -1) ? drawn.editId : loaded.editId || undefined;
    },
  };
}
