/**
 * A FOLDER'S PAGE — the trail and the shelf one viewer sees on a folder's own
 * address. The hierarchy itself (placement, moves, which children a viewer is
 * listed) is lib/artifacts/placement's; this module projects it for app chrome.
 */
import { getDb } from '@/lib/platform/db';
import { canRead } from '@artifactbin/contracts';
import { effectiveRole, LIVE_ARTIFACT_SQL, type ArtifactRow } from '@/lib/artifacts/access';
import type { RoleActor } from '@/lib/accounts/actors';
import { selectChildren, type Viewer } from '@/lib/artifacts/placement';
import type { ShelfRow } from './shelf';

/**
 * WHERE A FOLDER SITS — its ancestors, as the page's trail draws them.
 */
interface FolderCrumb {
  id: string;
  title: string | null;
  /** Where the crumb links — the ancestor's own address. */
  url: string;
}

/**
 * A FOLDER'S WHOLE PAGE, answered in ONE server call and inlined into the HTML
 * (server/app withBootstrap), so the listing is in the first byte.
 *
 * A folder has NO CONTENT: its row carries a title, a placement and an ACL and
 * nothing else, so everything a person sees on the page is on this object.
 * There is no document to render, no source to fetch and no frame to boot, so
 * the listing never waits on a sandboxed runtime an opaque origin cannot cache.
 */
export interface FolderPage {
  id: string;
  title: string | null;
  /** Root → parent, and ONLY the ancestors this viewer may read. */
  trail: FolderCrumb[];
  /**
   * WHAT THIS VIEWER CAN SEE, counted from the rows below and never by a
   * separate `COUNT(*)`. A count that included children they may not read
   * would be the existence oracle every other surface here refuses.
   */
  count: { documents: number; folders: number };
  /** The children, in the shape every other shelf takes. */
  rows: ShelfRow[];
}

/**
 * A folder's page, for ONE viewer. The trail and the shelf, and nothing else.
 *
 * Thumbnails here are the shelf's OWN (`/a/<child>/export?mode=card`), loaded
 * by the app page WITH the session — which a sandboxed frame cannot do, since
 * it carries no cookie and a private child's card 404s for its own owner.
 * Numbers follow the same rule the virtual table uses: only a viewer who may
 * EDIT the folder gets them.
 */
export async function folderPageFor(
  folder: ArtifactRow,
  viewer: Viewer,
): Promise<FolderPage> {
  const [head, picked] = await Promise.all([folderHeadFor(folder, viewer), selectChildren(folder, viewer)]);
  const rows: ShelfRow[] = [];
  let documents = 0;
  let folders = 0;
  for (const c of picked.children) {
    if (c.format === 'folder') folders++;
    else if (c.format === 'markup') documents++;
    rows.push({
      id: c.id,
      url: `/a/${c.id}`,
      title: c.title,
      format: c.format,
      version: c.version,
      visibility: c.visibility,
      updated_at: c.updated_at,
      // The picker greys a folder's own subtree, and the shelf reads placement
      // from either half of the wire — so both travel (lib/shelf parentOfRow).
      parent_id: folder.id,
      ancestor_ids: [...(folder.ancestor_ids ?? []), folder.id],
      // ABSENT, never zero: 'not counted for you' and 'nobody came' are
      // different facts, and the shelf omits the mark for the first.
      ...(picked.numbers ? { views: c.views, sparkline: await picked.sparkline(c.id) } : {}),
    });
  }
  return { ...head, count: { documents, folders }, rows };
}

/**
 * WHERE A FOLDER SITS, for the folder's own page — its name, its id, and the
 * ancestors THIS viewer may read.
 *
 * The trail is the half with a rule in it. `ancestor_ids` on a PUBLIC folder
 * can name a PRIVATE parent, so a page that drew the whole array would publish
 * one folder's existence and NAME to every stranger holding the child's link;
 * the ids half is settled by keeping the array out of a stranger's
 * payload. An ancestor a viewer may not read is simply ABSENT: not redacted,
 * not drawn unnamed, because a crumb saying "a folder you may not see" is the
 * existence oracle the uniform 404 exists to avoid.
 *
 * The reach test is `effectiveRole`, the same one every other surface asks, so
 * a public ancestor is named to everybody, a shared one to the person it was
 * shared with, and an anonymous token's own folder to the browser holding it.
 * One indexed read for the whole trail (`id = ANY(ancestor_ids)`, 1.4 ms
 * measured), ordered back into root→parent by the array rather than by the
 * database.
 */
async function folderHeadFor(
  folder: Pick<ArtifactRow, 'id' | 'title' | 'ancestor_ids'>,
  viewer: Viewer,
): Promise<{ id: string; title: string | null; trail: FolderCrumb[] }> {
  const head = { id: folder.id, title: folder.title, trail: [] as FolderCrumb[] };
  const ids = folder.ancestor_ids ?? [];
  if (!ids.length) return head;
  const db = await getDb();
  const actor: RoleActor = { userId: viewer?.userId ?? null, tokenId: viewer?.tokenId ?? null, email: viewer?.email ?? null };
  const r = await db.query<Pick<ArtifactRow, 'id' | 'title' | 'user_id' | 'token_id' | 'visibility' | 'link_role'>>(
    `SELECT id, title, user_id, token_id, visibility, link_role FROM artifacts
      WHERE id = ANY($1::text[]) AND ${LIVE_ARTIFACT_SQL}`,
    [ids],
  );
  const byId = new Map(r.rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    // A trashed ancestor is not in `byId` at all (the gate above), and one this
    // viewer cannot read is dropped here. Either way the trail is shorter, and
    // shorter is the honest answer.
    if (!row || !canRead(await effectiveRole(row, actor))) continue;
    head.trail.push({ id: row.id, title: row.title, url: `/a/${row.id}` });
  }
  return head;
}
