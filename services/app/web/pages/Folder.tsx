/**
 * A FOLDER'S PAGE — identity above, contents below, one rule between.
 *
 * WHY IT IS HERE AND NOT IN A DOCUMENT. A folder was briefly served as one: a
 * two-line scaffold whose `<Query>` read its own children and whose `<Files>`
 * drew them, inside the sandboxed frame every document is served in. Measured
 * on production, the owner's view of a folder went shell HTML 0.25 s → the
 * frame's document 0.98 s → the sandboxed runtime downloaded and booted
 * 2.59 s → the children query answered 2.86 s. The listing was the LAST thing
 * to paint, behind a runtime an opaque origin cannot cache, for a query the
 * server answers in about 50 ms. A listing is app data, not authored markup, so
 * it arrives with the HTML (`withBootstrap`) and this page draws it.
 *
 * WHAT THE PAGE IS. Nobody reads a folder; they scan it and leave. So exactly
 * one thing carries weight — the NAME — and everything else is set to stay out
 * of its way: the trail above it is an address and is set in the face this app
 * sets addresses in, the count below it is a sentence somebody would actually
 * say ("3 documents and 1 folder", not "3 · 1"), and a single hairline divides
 * identity from contents. That hairline is the only line on the page and it is
 * structural rather than decorative. There is no FOLDER label (the address says
 * so) and no icon beside the name (every tile below carries one).
 *
 * THE NAME IS ALSO THE CONTROL. Renaming is the only thing a person ever
 * changes about a folder — it has no content — so the name itself is the
 * button, and the field that replaces it is set in the same face at the same
 * size in the same place, so nothing moves when it opens. It writes through the
 * metadata door (`PATCH {title}`): a rename should not archive a version.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Shelf from '@/components/Shelf';
import WorkspaceLayout, { HOME_WORKSPACE_COLUMN } from '@/components/WorkspaceLayout';
import { PAGE_COLUMN } from '@/components/ui';
import type { ArtifactRole } from '@/lib/share-roles';
import { canEdit } from '@/lib/share-roles';
import type { FolderPage as FolderPageData } from '@/lib/folders';
import { STORY_DATA_EVENT } from '@/lib/story-runtime/contract';
import type { AccountWorkspace } from '@/lib/workspace';

export interface FolderPageProps {
  folder: FolderPageData;
  role: ArtifactRole;
  /** Present only for an account owner; totals and activity remain account-wide. */
  workspace?: AccountWorkspace;
}

/**
 * WHAT IS ON THE SHELF, as a sentence. Folders are counted apart from
 * everything else because they are the one row that is a place rather than a
 * thing — "4 items" answers a different question from "3 documents and 1
 * folder", and the second is the one somebody scanning a shelf is asking. An
 * empty folder says nothing here: its empty state below says it better.
 */
function summarise({ documents, folders }: FolderPageData['count']): string {
  const parts: string[] = [];
  if (documents) parts.push(`${documents} document${documents === 1 ? '' : 's'}`);
  if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

/**
 * THE NAME, and the field it becomes. One element in one place: the button and
 * the input carry the same type, size and tracking, so opening the field moves
 * nothing on the page — which is the whole reason renaming happens here rather
 * than in a dialog.
 */
const NAME_TYPE = 'font-serif text-[clamp(1.5rem,3vw,2rem)] leading-[1.15] font-medium tracking-[-0.01em] text-fg';

function Name({ id, title, mayRename, onRenamed }: { id: string; title: string | null; mayRename: boolean; onRenamed: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = title ?? 'Untitled folder';

  const save = useCallback(() => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title) return;
    // Optimistic: the door is a metadata write that cannot conflict, and a name
    // that snapped back a beat after being typed reads as a failure even when
    // the write succeeded. A refusal is answered by the live refetch below.
    onRenamed(next);
    void fetch(`/api/my/artifacts/${id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: next }),
    }).catch(() => { /* the listing re-reads on its own; a lost rename is not a lost document */ });
  }, [draft, id, onRenamed, title]);

  if (editing) {
    return (
      <input
        aria-label="Folder name"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={`${NAME_TYPE} w-full min-w-0 border-0 border-b border-accent bg-transparent p-0 focus:outline-none`}
      />
    );
  }
  if (!mayRename) return <span className={NAME_TYPE}>{shown}</span>;
  return (
    <button
      type="button"
      aria-label="Rename folder"
      onClick={() => { setDraft(title ?? ''); setEditing(true); }}
      className={`${NAME_TYPE} m-0 cursor-text border-0 border-b border-transparent bg-transparent p-0 text-left hover:border-edge-bright focus-visible:border-accent`}
    >
      {shown}
    </button>
  );
}

/**
 * AN EMPTY SCREEN IS AN INVITATION TO ACT, so it names the ways in that this
 * reader actually has. Someone who may write here gets both — the one a person
 * uses (move a document in from its menu) and the one an agent uses (the id it
 * publishes under). Someone who may not gets the plain fact, because telling a
 * visitor to hand their agent somebody else's folder id is noise.
 */
function Empty({ id, mayWrite }: { id: string; mayWrite: boolean }) {
  return (
    <div aria-label="Empty folder" className="rounded-[6px] border border-dashed border-edge px-4 py-6">
      <p className="m-0 font-sans text-sm text-fg">Nothing here yet.</p>
      {mayWrite && (
        <p className="m-0 mt-1 font-sans text-sm text-muted">
          Move a document in from its ⋯ menu, or give your agent{' '}
          <code className="rounded-sm bg-raised px-1 py-0.5 font-mono text-[0.9em] text-fg">parent_id: &quot;{id}&quot;</code>{' '}
          when it publishes.
        </p>
      )}
    </div>
  );
}

export function FolderPage({ folder: given, role, workspace: givenWorkspace }: FolderPageProps) {
  const [folder, setFolder] = useState(given);
  const [workspace, setWorkspace] = useState(givenWorkspace);
  // The prop is the server's answer for THIS address; a client navigation to
  // another folder must not keep the previous one's shelf.
  const seeded = useRef(given);
  if (seeded.current !== given) {
    seeded.current = given;
    if (folder.id !== given.id) setFolder(given);
    if (givenWorkspace !== workspace) setWorkspace(givenWorkspace);
  }

  const mayWrite = canEdit(role);

  /**
   * LIVE, over the stream the folder already has. A child created, moved,
   * renamed or trashed NOTIFYs its parent's channel (lib/folders notifyParent),
   * and the events route subscribes a folder to its OWN id as a data
   * dependency — so an agent publishing under this folder wakes this page as
   * an ordinary `data` frame and the listing re-reads with no reload.
   *
   * The ping carries no rows, like every other frame on this stream: what
   * travels is that something moved. The page asks the same endpoint the server
   * inlined, so what arrives is exactly what a fresh load would have shown.
   */
  const id = folder.id;
  const reread = useCallback(() => {
    void fetch(`/api/page/artifact/${id}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ folder?: FolderPageData; workspace?: AccountWorkspace }>) : null))
      .then((page) => {
        if (page?.folder) setFolder(page.folder);
        if (page?.workspace) setWorkspace(page.workspace);
      })
      .catch(() => { /* a dropped wakeup; the next ping retries */ });
  }, [id]);

  useEffect(() => {
    const source = new EventSource(`/a/${id}/events`);
    source.addEventListener(STORY_DATA_EVENT, reread);
    return () => { source.removeEventListener(STORY_DATA_EVENT, reread); source.close(); };
  }, [id, reread]);

  const summary = summarise(folder.count);
  const contents = (
    <>
      <header className="mb-6 border-b border-edge pb-4">
        {folder.trail.length > 0 && (
          /* THE TRAIL IS AN ADDRESS, so it is set in the face this app sets
             addresses in and separated by the character a path is separated by.
             Only the ancestors this viewer may read are here — an unreadable one
             is absent rather than redacted (lib/folders folderHeadFor). */
          <nav aria-label="Folder trail" className="mb-2 flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-faint">
            {folder.trail.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-x-1.5">
                {i > 0 && <span aria-hidden="true">/</span>}
                <a href={crumb.url} className="text-faint no-underline transition-colors hover:text-accent">
                  {crumb.title ?? crumb.id}
                </a>
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="m-0 min-w-0 flex-1">
            <Name id={folder.id} title={folder.title} mayRename={mayWrite} onRenamed={(title) => setFolder((f) => ({ ...f, title }))} />
          </h1>
          {summary && <p className="m-0 shrink-0 font-sans text-sm text-muted">{summary}</p>}
        </div>
      </header>

      {folder.rows.length === 0 && <div className="mb-5"><Empty id={folder.id} mayWrite={mayWrite} /></div>}
      {/* The shelf the dashboard and the profiles already draw. `full` for
        * anyone who may write here, `share` for everyone else — handing someone
        * the link is what a public folder is for, and nothing a visitor does
        * should change the document. `parentId` is what makes a folder created
        * here land INSIDE this one rather than at the root.
        *
        * Rendered even when empty, and that is the point of the empty state
        * sitting above rather than instead of it: the bar still carries `New
        * folder` for someone who may write, while a visitor's empty folder
        * draws no chrome at all (the shelf renders nothing without rows or that
        * capability). */}
      <Shelf
        rows={(workspace?.artifacts ?? folder.rows) as never}
        actions={mayWrite ? 'full' : 'share'}
        canCreateFolders={mayWrite && !workspace}
        parentId={folder.id}
        scopeParentId={folder.id}
        assets={false}
      />
    </>
  );

  if (workspace) {
    return (
      <main aria-label="Folder" className={`${HOME_WORKSPACE_COLUMN} mt-8 pb-24`}>
        <WorkspaceLayout workspace={workspace} parentId={folder.id} onCreated={reread} label="Folder workspace">
          {contents}
        </WorkspaceLayout>
      </main>
    );
  }

  return (
    <main aria-label="Folder" className={`${PAGE_COLUMN} mt-8 pb-24`}>
      {contents}
    </main>
  );
}
