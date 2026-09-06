'use client';

/**
 * THE SHELF — one presentation for the homepage and public profiles.
 *
 * `/` (the dashboard) and `/@handle` (the public profile) answer different
 * questions with the same drive-like presentation. This component fetches
 * nothing: each page runs its own query and hands over rows plus what the
 * viewer may do with them.
 *
 * The capability props are the seam. A profile passes no `views`, so no
 * spline is drawn and no column is reserved — OPTIONAL FIELDS DEGRADE, which
 * is the whole test of whether the seam is in the right place. If adding view
 * counts to the dashboard required touching the profile, this would be the
 * wrong shape.
 *
 * Partitioning and recency order live in `lib/shelf` (pure). This file owns
 * the grid/list presentation and hands list mode to `ArtifactTable`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderInput, FolderPlus, LayoutGrid, List as ListIcon, Pencil, Search, Share2, Trash2 } from 'lucide-react';
import ShareLink from '@/components/ShareLink';
import RowMenu, { confirmDeleteArtifact } from '@/components/RowMenu';
import { MoveMenu, type PickerFolder } from '@/components/FolderPicker';
import { ArtifactTable } from '@/components/TokenBrowser';
import { Tooltip } from '@/components/Tooltip';
import { dateStamp, MicroLabel, PANEL, timeAgo, VISIBILITY_TIPS, VisibilityPill } from '@/components/ui';
import { ViewsMark } from '@/components/ViewsMark';
import { buildShelf, groupShelfByRecency, parentOfRow, type ShelfRow } from '@/lib/shelf';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';

const FOLDER_PREVIEW_LIMIT = 5;

/**
 * The row shape lives with the POLICY (lib/shelf), because it is what a page
 * ANSWERS rather than how the answer looks — three server modules build these
 * rows and none of them may import React. Re-exported here so every existing
 * `import type { ShelfRow } from '@/components/Shelf'` still reads.
 */
export type { ShelfRow } from '@/lib/shelf';

/**
 * WHAT A VIEWER MAY DO WITH A ROW — a LEVEL, not a boolean, because the three
 * surfaces need three different subsets:
 *
 * - `none`  a stranger reading
 * - `share` a PROFILE: handing someone the link is the whole point of the
 *           page, and nothing there should change the document
 * - `full`  the owner's dashboard: share, edit, and the overflow menu
 *
 * Withholding is the DEFAULT. A capability that has to be asked for cannot be
 * granted by forgetting a prop.
 */
export type ShelfActions = 'none' | 'share' | 'full';

export interface ShelfProps {
  rows: ShelfRow[];
  actions?: ShelfActions;
  showVisibility?: boolean;
  /**
   * Show only the immediate children of this location. `null` is the account
   * root; `undefined` preserves the caller's already-scoped collection.
   *
   * The complete `rows` collection remains available to folder counts and the
   * move picker, so scoping what is visible does not amputate the folder tree.
   */
  scopeParentId?: string | null;
  /**
   * Show the band of datasets and images. The dashboard is where material is
   * managed; a profile is about the documents, and listing the material there
   * is the junk-drawer `listPublicArtifactsByUser` already refuses to be.
   */
  assets?: boolean;
  /**
   * How a timestamp reads. RELATIVE ("3 hrs ago") narrates activity and
   * belongs on the owner's own surfaces, where recency is the thing being
   * judged. ABSOLUTE ("Aug 29, 2026") is the public face of a timestamp — a
   * profile is a record, not a feed, and "just now" tells a visitor nothing
   * they can cite. Same split `dateStamp`/`timeAgo` have always drawn.
   */
  dates?: 'relative' | 'absolute';
  /** The folder that a folder created from this shelf should belong to. */
  parentId?: string | null;
  /** Folder pages opt into creation without inheriting the homepage's row actions. */
  canCreateFolders?: boolean;
}

/** Create a child folder in place, preserving the shelf's current view state. */
function NewFolder({ parentId, onMade }: { parentId: string | null; onMade: (row: ShelfRow) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    const response = await fetch('/api/my/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'folder', title, parent_id: parentId }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) return;
    const body = (await response.json().catch(() => null)) as (Partial<ShelfRow> & { id?: string }) | null;
    if (!body?.id) return;
    onMade({
      ...body,
      id: body.id,
      url: body.url ?? `/a/${body.id}`,
      title: body.title ?? title,
      format: 'folder',
      version: body.version ?? 1,
      visibility: body.visibility ?? 'private',
      updated_at: body.updated_at ?? new Date().toISOString(),
      parent_id: body.parent_id ?? parentId,
    });
    setName('');
    setNaming(false);
  };

  if (!naming) {
    return (
      <Tooltip content="create a folder here">
        <button
          type="button"
          aria-label="New folder"
          onClick={() => setNaming(true)}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] px-2 font-mono text-[10px] text-muted transition-colors hover:bg-raised hover:text-accent"
        >
          <FolderPlus size={12} /> new folder
        </button>
      </Tooltip>
    );
  }

  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1">
      <input
        aria-label="Folder name"
        placeholder="folder name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void create(); }
          if (event.key === 'Escape') { event.preventDefault(); setName(''); setNaming(false); }
        }}
        className="h-7 w-36 rounded-[4px] border border-edge bg-transparent px-1.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
      />
      <span className="font-mono text-[10px] text-faint">{busy ? 'creating…' : 'enter'}</span>
    </span>
  );
}

/** Folder covers show a small stack of readable documents inside a tabbed sleeve. */
function FolderCover({ row, documents, count, controls, showVisibility }: { showVisibility: boolean; row: ShelfRow; documents: ShelfRow[]; count: number; controls: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<ShelfRow[]>([]);
  // Owner shelves already carry their children. Public profiles omit placement,
  // so ask the folder's existing ACL-filtered page only as its cover comes into view.
  useEffect(() => {
    if (documents.length || !box.current || typeof IntersectionObserver === 'undefined') return;
    const controller = new AbortController();
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void fetch(`/api/page/artifact/${row.id}`, { credentials: 'same-origin', signal: controller.signal })
        .then((res) => res.ok ? res.json() : null)
        .then((page) => { if (!controller.signal.aborted && page?.folder?.rows) setLoaded(page.folder.rows); })
        .catch(() => {});
    }, { rootMargin: '160px' });
    observer.observe(box.current);
    return () => { controller.abort(); observer.disconnect(); };
  }, [row.id, documents.length]);
  const contents = (documents.length ? documents : loaded)
    .filter((item) => item.format === 'markup')
    .slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const previews = contents.slice(0, FOLDER_PREVIEW_LIMIT);
  const remaining = contents.length - previews.length;
  const papers = previews.length ? previews : [null, null];
  const paperCount = papers.length + (remaining > 0 ? 1 : 0);
  const paperStyle = (index: number) => ({ '--paper-position': index / Math.max(1, paperCount - 1) } as React.CSSProperties);
  const itemCount = count || documents.length || loaded.length;
  return (
    <div ref={box} aria-label={`Preview of folder ${row.title ?? row.id}`} className="folder-cover">
      <a href={row.url} aria-label={`Open folder ${nameOf(row)}`} className="absolute inset-0 z-[2] rounded-md focus-visible:outline-2 focus-visible:outline-accent" />
      <div className="folder-cover-tab">
        <span className="truncate font-mono text-[10px] tabular-nums">{itemCount > 0 ? `${itemCount} artifact${itemCount === 1 ? '' : 's'}` : 'artifacts'}</span>
      </div>
      <div className="folder-cover-back" />
      {showVisibility && row.visibility && <span className="folder-cover-visibility absolute left-2 top-[27px] z-[3]"><VisibilityPill compact overlay visibility={row.visibility} name={nameOf(row)} /></span>}
      <div className="folder-cover-papers" style={{ '--paper-width': paperCount > 2 ? '48%' : '61%' } as React.CSSProperties}>
        {papers.map((item, i) => (
          <div key={item?.id ?? i} aria-hidden="true" className="folder-cover-paper" style={paperStyle(i)}>
            {item ? <img src={`/a/${item.id}/export?format=jpg&mode=card&v=${item.version}&r=${CARD_RENDER_GENERATION}`} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <div className="folder-cover-lines" />}
          </div>
        ))}
        {remaining > 0 && (
          <div className="folder-cover-paper folder-cover-more" style={paperStyle(papers.length)}>
            <span>+{remaining}</span><span>more</span>
          </div>
        )}
      </div>
      <div className="folder-cover-front">
        <span className="min-w-0 flex-1 truncate pr-2 font-mono text-[13px] font-semibold" title={nameOf(row)}>{nameOf(row)}</span>
        <div className="relative z-[3] ml-auto flex min-w-0 items-center gap-1.5">{controls}</div>
      </div>
    </div>
  );
}

function FolderTile({ row, count, level, folders, onDeleted, documents, gallery, showVisibility }: { showVisibility: boolean; row: ShelfRow; count: number; level: ShelfActions; folders: PickerFolder[]; onDeleted: (id: string) => void; documents: ShelfRow[]; gallery: boolean }) {
  /**
   * RENAMING IS THE ONE VERB A FOLDER HAS THAT A DOCUMENT DOES NOT NEED HERE.
   * A document is renamed in its editor's Title field; a folder has no content
   * and therefore no editor, so the pencil beside it opened on nothing. The
   * verb moves into the menu with the other folder verbs and edits the tile in
   * place, through the metadata door (PATCH {title}) rather than the replace
   * one — a name should not archive a version.
   */
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState<string | null>(row.title);
  const shown = { ...row, title };
  const save = () => {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === title) return;
    setTitle(next);
    void fetch(`/api/my/artifacts/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    }).catch(() => { /* the next load reads the server's answer */ });
  };
  if (renaming) {
    return (
      <li className={`reveal relative flex items-center gap-2 px-3 py-2.5 ${PANEL} border-accent`}>
        <Folder size={14} className="shrink-0 text-accent" />
        <input
          aria-label="Folder name"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-sm font-semibold text-fg focus:outline-none"
        />
      </li>
    );
  }
  if (gallery) {
    return (
      <li className="reveal group relative rounded-md p-3 transition-colors hover:bg-raised/60">
        <FolderCover row={shown} documents={documents} showVisibility={showVisibility} count={count} controls={<>
          <Actions row={shown} level={level} folders={folders} childCount={count} onDeleted={onDeleted}
            onRename={() => { setDraft(title ?? ''); setRenaming(true); }} />
        </>} />
      </li>
    );
  }
  return (
    <li className={`reveal group relative flex items-center gap-2 px-3 py-2.5 ${PANEL} hover:border-edge-bright transition-colors`}>
      <Folder size={14} className="shrink-0 text-faint transition-colors group-hover:text-accent" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
      {/* A STRETCHED LINK: the whole tile opens the folder, while the actions
          beside it sit above the pseudo-element rather than inside the anchor
          (a <button> in an <a> is invalid markup and swallows its own click). */}
      <a
        href={row.url}
        aria-label={`Open folder ${nameOf(shown)}`}
        className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent"
      >
        {title ?? row.id}
      </a>
      {/* Only when there IS one. This count is what THIS shelf holds under the
          folder, and a profile's listing is root-scoped (its children are on
          the folder's own page) — so a zero here would be a wrong number
          rather than an empty folder. */}
      {count > 0 && <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">{count}</span>}
      {showVisibility && row.visibility && <VisibilityPill compact visibility={row.visibility} name={nameOf(shown)} />}
      <Actions
        row={shown}
        level={level}
        folders={folders}
        childCount={count}
        onDeleted={onDeleted}
        onRename={() => { setDraft(title ?? ''); setRenaming(true); }}
      />
      </div>
    </li>
  );
}

/** Icon-only row action — the label lives in the tooltip, not beside the glyph. */
const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors hover:text-accent';

const VISIBILITY_ORDER = ['public', 'unlisted', 'private'] as const;

const nameOf = (row: ShelfRow) => row.title ?? row.id;

/**
 * Copy-link and edit in grid mode. List mode exposes the same capability set
 * through `ArtifactTable`.
 *
 * `relative z-10` is load-bearing: the card body is a STRETCHED LINK (an
 * anchor whose ::after covers the whole card), because a <button> nested
 * inside an <a> is invalid markup and swallows its own click. These sit above
 * that pseudo-element instead of inside the anchor.
 */
function Actions({ row, level, folders, childCount = 0, onDeleted, onRename }: { row: ShelfRow; level: ShelfActions; folders: PickerFolder[]; childCount?: number; onDeleted?: (id: string) => void; onRename?: () => void }) {
  const [moving, setMoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [parentId, setParentId] = useState(parentOfRow(row));
  if (level !== 'full') return null;
  return (
    <span className="relative z-10 inline-flex shrink-0 items-center gap-0.5">
      {level === 'full' && (
        <>
          {/* A FOLDER HAS NO DOCUMENT TO EDIT, so it is offered no editor —
              `#edit` on one would open a mode with nothing in it. Its rename
              lives in the menu below instead. */}
          {!onRename && (
            <Tooltip content="edit">
              <a aria-label={`Edit ${nameOf(row)}`} href={`/a/${row.id}#edit`} className={`${ICON_ACTION} shelf-secondary-action no-underline`}>
                <Pencil size={13} />
              </a>
            </Tooltip>
          )}
          <RowMenu
            name={nameOf(row)}
            items={[
              {
                label: `Manage sharing for ${nameOf(row)}`,
                text: 'share',
                icon: <Share2 size={12} />,
                onSelect: () => setSharing(true),
              },
              ...(onRename ? [{
                label: `Rename ${nameOf(row)}`,
                text: 'rename',
                icon: <Pencil size={12} />,
                onSelect: onRename,
              }] : []),
              {
                label: `Move ${nameOf(row)}`,
                text: 'move to folder',
                icon: <FolderInput size={12} />,
                onSelect: () => setMoving(true),
              },
              {
                label: `Delete ${nameOf(row)}`,
                // The row SAYS how much goes with it, and the confirm says it
                // again in a sentence: deleting a folder is deleting everything
                // under it, in one statement, into a trash it can be taken back
                // out of at any time (lib/trash).
                text: childCount > 0 ? `delete (${childCount} inside)` : 'delete',
                icon: <Trash2 size={12} />,
                danger: true,
                onSelect: () => {
                  void confirmDeleteArtifact(row.id, nameOf(row), childCount).then((ok) => {
                    if (!ok) return;
                    // A caller that can drop the row does; anything else falls
                    // back to the reload the dense tier has always used.
                    if (onDeleted) onDeleted(row.id);
                    else window.location.reload();
                  });
                },
              },
            ]}
          />
        </>
      )}
      {sharing && (
        <ShareLink className="" artifactId={row.id} title={row.title} owner format={row.format} url={row.url} variant="dialog" onClose={() => setSharing(false)} />
      )}
      {moving && (
        <MoveMenu
          row={{ id: row.id, format: row.format, parent_id: parentId, ancestor_ids: row.ancestor_ids }}
          folders={folders}
          onMoved={setParentId}
          onClose={() => setMoving(false)}
        />
      )}
    </span>
  );
}

/** The document collection already guarantees `markup`; visibility is the only
 * classification that adds information here. */
function VisibilityTag({ row, overlay = false }: { row: ShelfRow; overlay?: boolean }) {
  return row.visibility ? (
    <VisibilityPill visibility={row.visibility} name={nameOf(row)} compact overlay={overlay} />
  ) : null;
}

/** The artifact's own og card — one lazily-rendered image serves unfurls and the drive grid alike. */
function Thumb({ row, className }: { row: ShelfRow; className: string }) {
  return (
    <span className={`relative block w-full overflow-hidden bg-raised ${className}`}>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge-bright border-t-accent" />
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/a/${row.id}/export?format=jpg&mode=card&v=${row.version}&r=${CARD_RENDER_GENERATION}`}
        alt=""
        loading="lazy"
        className="relative h-full w-full object-cover"
      />
    </span>
  );
}

/**
 * Rows per page in list mode and in the separate assets table.
 */
export const SHELF_LIST_PER_PAGE = 10;

/** Multi-select quick filter. The pressed state is the whole contract. */
function FilterChip({ value, active, onToggle }: { value: string; active: boolean; onToggle: (v: string) => void }) {
  return (
    <Tooltip content={VISIBILITY_TIPS[value] ?? ''}>
      <button
        type="button"
        aria-label={`Filter ${value}`}
        aria-pressed={active}
        onClick={() => onToggle(value)}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap transition-colors ${
          active ? 'border-accent/50 bg-accent-soft text-accent' : 'border-edge text-faint'
        }`}
      >
        {value}
      </button>
    </Tooltip>
  );
}

export default function Shelf({ rows, actions = 'none', showVisibility = true, assets = true, dates = 'relative', scopeParentId, parentId = null, canCreateFolders = false }: ShelfProps) {
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<string[]>([]);
  const [made, setMade] = useState<ShelfRow[]>([]);
  /*
   * Folders TRASHED here, and everything that went with them. A folder is
   * deleted with its whole subtree in one statement (lib/trash), so dropping
   * only the tile would leave its documents on the shelf pointing at rows that
   * are 404 — and reloading to find that out would throw away the search, the
   * filters and the scroll, exactly as creating one would.
   */
  const [trashed, setTrashed] = useState<string[]>([]);
  const trash = (id: string) => setTrashed((t) => [...t, id]);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('artifactbin:shelf-view');
      if (saved === 'grid' || saved === 'list') setView(saved);
    } catch { /* Storage may be disabled; view switching still works. */ }
  }, []);
  const chooseView = (next: typeof view) => {
    setView(next);
    try { localStorage.setItem('artifactbin:shelf-view', next); } catch { /* Optional preference. */ }
  };
  const q = query.trim().toLowerCase();
  const present = trashed.length
    ? rows.filter((r) => !trashed.includes(r.id) && !(r.ancestor_ids ?? []).some((a) => trashed.includes(a)))
    : rows;
  // `assets={false}` removes supporting files from the whole shelf contract,
  // including search counts and visibility chips. Their management surface is
  // `/assets`; leaving them in these derivations would make Home report hidden
  // matches that it can never render.
  const available = made.length > 0 ? [...made, ...present] : present;
  const inventory = assets ? available : available.filter((row) => row.format === 'markup' || row.format === 'folder');
  // LOCATION decides what is drawn. Home passes null and becomes a true root
  // shelf; folder pages pass their id and show immediate children only. A
  // pre-scoped caller can omit the prop and keep its rows unchanged.
  const all = scopeParentId === undefined
    ? inventory
    : inventory.filter((row) => parentOfRow(row) === scopeParentId);

  const togglePick = (v: string) => setPicks((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  // Chips are derived from the rows, so a shelf with nothing to split on shows
  // no dead controls.
  const chips = VISIBILITY_ORDER.filter((v) => all.some((r) => r.visibility === v));
  const showChips = chips.length >= 2;

  const shelf = useMemo(() => {
    const matched = all.filter(
      (r) =>
        (!q || `${r.title ?? ''} ${r.description ?? ''} ${r.format}`.toLowerCase().includes(q)) &&
        (picks.length === 0 || (r.visibility != null && picks.includes(r.visibility))),
    );
    return buildShelf(matched);
  }, [all, q, picks]);

  /** The account's folders, for every picker on this shelf — the tree, unfiltered. */
  const pickable: PickerFolder[] = useMemo(
    () => available.filter((r) => r.format === 'folder').map((r) => ({ id: r.id, title: r.title, ancestor_ids: r.ancestor_ids ?? [] })),
    [available],
  );
  /**
   * How many rows THIS shelf holds inside a folder — what the page was given
   * and no more. The dashboard lists the whole account, so its number is the
   * folder's; a profile lists the ROOT, so it has none to count and shows none.
   */
  const inside = (id: string): number => available.filter((r) => parentOfRow(r) === id).length;
  const dateGroups = useMemo(() => groupShelfByRecency(shelf.documents), [shelf.documents]);

  const filtering = Boolean(q) || picks.length > 0;
  const nothing = shelf.documents.length === 0 && shelf.assets.length === 0 && shelf.folders.length === 0;

  return (
    <section aria-label="Shelf" data-shelf-view={view} className="flex flex-col gap-4">
      {(all.length > 0 || canCreateFolders) && (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1.5 sm:rounded-[6px] sm:border sm:border-edge sm:bg-surface sm:px-3 sm:py-1.5">
          <div className={`flex min-w-0 items-center gap-2 px-3 py-1.5 ${PANEL} sm:flex-1 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}>
            <Search size={13} className="shrink-0 text-faint" />
            <input
              aria-label="Search artifacts"
              placeholder="search artifacts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-0.5 sm:contents">
            {showChips && (
              <span className="flex shrink-0 items-center gap-1.5 sm:border-l sm:border-edge sm:pl-2">
                {chips.map((v) => (
                  <FilterChip key={v} value={v} active={picks.includes(v)} onToggle={togglePick} />
                ))}
              </span>
            )}
            {filtering && (
              <span className="shrink-0 border-l border-edge pl-2 font-mono text-[10px] tabular-nums text-faint">
                {shelf.total + shelf.assets.length}/{all.length}
              </span>
            )}
          {canCreateFolders && (
            <span className="shrink-0 border-l border-edge pl-1.5">
              <NewFolder parentId={parentId} onMade={(row) => setMade((current) => [row, ...current])} />
            </span>
          )}
          <div role="group" aria-label="Shelf view" className="ml-auto flex shrink-0 items-center border-l border-edge pl-1.5">
            {([
              ['grid', 'Grid view', LayoutGrid],
              ['list', 'List view', ListIcon],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={view === value}
                onClick={() => chooseView(value)}
                className={`inline-flex h-7 w-8 cursor-pointer items-center justify-center rounded-[4px] transition-all ${
                  view === value ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-raised hover:text-fg'
                }`}
              >
                <Icon size={14} strokeWidth={1.7} />
              </button>
            ))}
          </div>
          </div>
        </div>
      )}

      {/* FOLDERS — above the documents, and only for an account that has one.
        * A folder is where the deliverables are rather than a deliverable, so
        * it is neither a document tier nor an asset (lib/shelf's third
        * partition), and `total` still counts documents: making a folder never
        * changes what the shelf says you have. */}
      {view === 'grid' && shelf.folders.length > 0 && (
        /*
         * `relative z-20` is load-bearing, and was found by a real click. Every
         * row here carries `.reveal`, which is a CSS ANIMATION — so each row is
         * its own stacking context and a menu's `z-30` cannot escape it. The
         * strip sits ABOVE the document tiers in the DOM, so painting order put
         * a folder's open menu UNDERNEATH the hero card below it: visible,
         * and unclickable. Raising the section raises everything inside it.
         */
        <section aria-label="Folders" className="relative z-20">
          <div className="mb-2 flex items-baseline gap-2">
            <MicroLabel>folders</MicroLabel>
          </div>
          <ul className={`grid gap-3 ${view === 'grid' ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'} lg:grid-cols-4`}>
            {shelf.folders.map((row) => (
              <FolderTile showVisibility={showVisibility} key={row.id} row={row} count={inside(row.id)} level={actions} folders={pickable} onDeleted={trash} gallery={view === 'grid'} documents={available.filter((item) => parentOfRow(item) === row.id && item.format === 'markup')} />
            ))}
          </ul>
        </section>
      )}

      {nothing && filtering && (
        <p aria-label="No matches" className="px-1 font-mono text-xs text-faint">
          nothing matches the active {q ? 'search' : 'filters'}
        </p>
      )}

      {view !== 'list' && shelf.documents.length > 0 && (
        <div aria-label="Artifact grid" className="flex flex-col gap-7">
          {dateGroups.map((group) => (
            <section key={group.key} aria-label={`${group.label} artifacts`}>
              <div className="mb-2.5 flex items-center gap-3 px-0.5">
                <h2 className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-muted">
                  {group.label}
                </h2>
                <span aria-hidden="true" className="h-px flex-1 bg-edge" />
              </div>
              <ul className="grid grid-cols-2 gap-2 sm:gap-5 lg:grid-cols-4">
                {group.rows.map((row) => {
                  const i = shelf.documents.indexOf(row);
                  return (
                    <li
                      key={row.id}
                      className="reveal group relative flex min-w-0 flex-col duration-150 gallery-document rounded-md p-1 sm:p-2 transition-colors hover:bg-raised/60"
                      style={{ animationDelay: `${Math.min(i * 35, 280)}ms` }}
                    >
                      <div className="relative">
                        <Thumb row={row} className="gallery-paper aspect-[5/3] rounded-[4px] border border-edge shadow-sm" />
                        {showVisibility && row.visibility && <span className="gallery-fade-visibility absolute left-2 top-2 z-10"><VisibilityTag row={row} overlay /></span>}
                        {(row.views !== undefined || actions === 'full') && (
                          <div className="gallery-fade absolute inset-x-0 bottom-0 z-10 flex min-w-0 items-center gap-2">
                            {row.views !== undefined && <div className="gallery-fade-views min-w-0 flex-1"><ViewsMark name={nameOf(row)} views={row.views} sparkline={row.sparkline} /></div>}
                            {actions === 'full' && <div className="gallery-fade-actions ml-auto shrink-0"><Actions row={row} level={actions} folders={pickable} /></div>}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 px-1 pt-2.5 pb-1">
                        <div className="flex items-start justify-center gap-1.5">
                        <a
                          href={row.url}
                          aria-label={`Open ${nameOf(row)}`}
                          className={`block font-mono leading-snug font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent text-center text-[13px] line-clamp-2`}
                        >
                          {row.title ?? 'Untitled'}
                        </a>
                        </div>
                        {row.description && <p className="m-0 line-clamp-2 text-center font-sans text-xs leading-relaxed text-muted">{row.description}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {view === 'list' && (shelf.documents.length > 0 || shelf.folders.length > 0) && (
        <ArtifactTable
          showVisibility={showVisibility}
          artifacts={[...shelf.folders, ...shelf.documents].filter((row, _, roots) => !roots.some((folder) => folder.format === 'folder' && folder.id === parentOfRow(row)))}
          treeRows={inventory}
          includeAssets={assets}
          folders={pickable}
          manage={actions === 'full'}
          canEdit={actions === 'full'}
          embedded
          dates={dates}
          perPage={SHELF_LIST_PER_PAGE}
        />
      )}

      {/* Not a tier: the material documents are built from. */}
      {assets && shelf.assets.length > 0 && (
        <section aria-label="Assets">
          <div className="mb-2 flex items-baseline gap-2">
            <MicroLabel>assets</MicroLabel>
            <span className="font-mono text-[10px] text-faint">the material documents are built from</span>
          </div>
          <ArtifactTable
            artifacts={shelf.assets}
            folders={pickable}
            manage={actions === 'full'}
            canEdit={false}
            showViews={false}
            filtersInline
            dates={dates}
            perPage={SHELF_LIST_PER_PAGE}
          />
        </section>
      )}
    </section>
  );
}
