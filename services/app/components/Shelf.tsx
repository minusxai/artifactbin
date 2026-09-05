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
import { useMemo, useState } from 'react';
import { Check, Folder, FolderInput, FolderPlus, LayoutGrid, Link2, List as ListIcon, Pencil, Search, Trash2 } from 'lucide-react';
import RowMenu, { confirmDeleteArtifact } from '@/components/RowMenu';
import { MoveMenu, type PickerFolder } from '@/components/FolderPicker';
import { ArtifactTable } from '@/components/TokenBrowser';
import { Tooltip } from '@/components/Tooltip';
import { dateStamp, MicroLabel, PANEL, timeAgo, VISIBILITY_TIPS, VisibilityPill } from '@/components/ui';
import { ViewsMark } from '@/components/ViewsMark';
import { buildShelf, groupShelfByRecency, parentOfRow, type ShelfRow } from '@/lib/shelf';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';

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

/**
 * THE FOLDERS STRIP — a third partition of the shelf (lib/shelf `folders`),
 * above the documents and absent for an account that has none, so nothing moves
 * for someone who never makes one.
 *
 * A folder is an artifact, so a tile is an ordinary link to `/a/<id>`; what it
 * adds over a document card is that a folder has no thumbnail worth taking (its
 * own card would be a picture of this listing) and a count instead.
 */
function FolderTile({ row, count, level, folders, onDeleted }: { row: ShelfRow; count: number; level: ShelfActions; folders: PickerFolder[]; onDeleted: (id: string) => void }) {
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
  return (
    <li className={`reveal group relative flex items-center gap-2 px-3 py-2.5 ${PANEL} transition-colors hover:border-edge-bright`}>
      <Folder size={14} className="shrink-0 text-faint transition-colors group-hover:text-accent" />
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
      {row.visibility && <VisibilityPill compact visibility={row.visibility} name={nameOf(shown)} />}
      <Actions
        row={shown}
        level={level}
        folders={folders}
        childCount={count}
        onDeleted={onDeleted}
        onRename={() => { setDraft(title ?? ''); setRenaming(true); }}
      />
    </li>
  );
}

/** Icon-only row action — the label lives in the tooltip, not beside the glyph. */
const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors hover:text-accent';

const CARD_ACTION_SURFACE =
  'flex h-[26px] items-center rounded-[4px] border border-edge bg-surface/90 px-0.5';

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
  const [copied, setCopied] = useState(false);
  const [moving, setMoving] = useState(false);
  const [parentId, setParentId] = useState(parentOfRow(row));
  const share = async () => {
    const url = row.url.startsWith('http') ? row.url : `${location.origin}${row.url}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.open(url, '_blank');
    }
  };
  if (level === 'none') return null;
  return (
    <span className="relative z-10 inline-flex shrink-0 items-center gap-0.5">
      <Tooltip content={copied ? 'copied!' : 'copy share link'}>
        <button
          type="button"
          aria-label={`Share ${nameOf(row)}`}
          onClick={share}
          className={`${ICON_ACTION} ${copied ? 'text-accent' : ''}`}
        >
          {copied ? <Check size={13} /> : <Link2 size={13} />}
        </button>
      </Tooltip>
      {level === 'full' && (
        <>
          {/* A FOLDER HAS NO DOCUMENT TO EDIT, so it is offered no editor —
              `#edit` on one would open a mode with nothing in it. Its rename
              lives in the menu below instead. */}
          {!onRename && (
            <Tooltip content="edit">
              <a aria-label={`Edit ${nameOf(row)}`} href={`/a/${row.id}#edit`} className={`${ICON_ACTION} no-underline`}>
                <Pencil size={13} />
              </a>
            </Tooltip>
          )}
          <RowMenu
            name={nameOf(row)}
            items={[
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

/**
 * THE PICTURE CARRIES THE CHROME — on every tier, at the same corner.
 *
 * The hero used to keep its classification and controls at the top of its
 * RIGHT column, which reads correctly only while that column is beside the
 * thumbnail. On a phone the grid stacks, the column falls underneath, and the
 * two controls that overlay the picture on every card below sat in a band
 * under the picture on the one above them — the tiers stopped looking like
 * one shelf. Hanging them on the picture is ONE rule with no breakpoint fork,
 * and the hero's right column is then free to be nothing but the document.
 */
function CardControls({ row, level, folders }: { row: ShelfRow; level: ShelfActions; folders: PickerFolder[] }) {
  if (!row.visibility && level === 'none') return null;
  return (
    <div
      aria-label={`${nameOf(row)} card controls`}
      className="absolute inset-x-2.5 top-2.5 z-10 flex items-start justify-between gap-2"
    >
      <VisibilityTag row={row} overlay />
      {level !== 'none' && (
        <div className={`${CARD_ACTION_SURFACE} ml-auto`}>
          <Actions row={row} level={level} folders={folders} />
        </div>
      )}
    </div>
  );
}

function Stamp({ row, mode, trailing = false }: { row: ShelfRow; mode: 'relative' | 'absolute'; trailing?: boolean }) {
  return (
    <Tooltip content={new Date(row.updated_at).toLocaleString()}>
      <time
        aria-label={`${nameOf(row)} updated`}
        dateTime={row.updated_at}
        suppressHydrationWarning
        className={`${trailing ? 'ml-auto' : ''} shrink-0 font-mono text-[11px] whitespace-nowrap text-muted`}
      >
        {mode === 'absolute' ? dateStamp(row.updated_at) : timeAgo(row.updated_at)}
      </time>
    </Tooltip>
  );
}

/** The document collection already guarantees `markup`; visibility is the only
 * classification that adds information here. */
function VisibilityTag({ row, overlay = false }: { row: ShelfRow; overlay?: boolean }) {
  return row.visibility ? (
    <VisibilityPill visibility={row.visibility} name={nameOf(row)} compact={overlay} overlay={overlay} />
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

export default function Shelf({ rows, actions = 'none', assets = true, dates = 'relative', parentId = null, canCreateFolders = false }: ShelfProps) {
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
  const q = query.trim().toLowerCase();
  const present = trashed.length
    ? rows.filter((r) => !trashed.includes(r.id) && !(r.ancestor_ids ?? []).some((a) => trashed.includes(a)))
    : rows;
  // `assets={false}` removes supporting files from the whole shelf contract,
  // including search counts and visibility chips. Their management surface is
  // `/assets`; leaving them in these derivations would make Home report hidden
  // matches that it can never render.
  const available = made.length > 0 ? [...made, ...present] : present;
  const all = assets ? available : available.filter((row) => row.format === 'markup' || row.format === 'folder');

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
    () => all.filter((r) => r.format === 'folder').map((r) => ({ id: r.id, title: r.title, ancestor_ids: r.ancestor_ids ?? [] })),
    [all],
  );
  /**
   * How many rows THIS shelf holds inside a folder — what the page was given
   * and no more. The dashboard lists the whole account, so its number is the
   * folder's; a profile lists the ROOT, so it has none to count and shows none.
   */
  const inside = (id: string): number => all.filter((r) => parentOfRow(r) === id).length;
  const dateGroups = useMemo(() => groupShelfByRecency(shelf.documents), [shelf.documents]);

  const filtering = Boolean(q) || picks.length > 0;
  const nothing = shelf.documents.length === 0 && shelf.assets.length === 0 && shelf.folders.length === 0;

  return (
    <section aria-label="Shelf" className="flex flex-col gap-4">
      {(all.length > 0 || canCreateFolders) && (
        <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5 ${PANEL}`}>
            <Search size={13} className="shrink-0 text-faint" />
            <input
              aria-label="Search artifacts"
              placeholder="search artifacts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
            />
            {showChips && (
              <span className="flex shrink-0 items-center gap-1.5 border-l border-edge pl-2">
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
                onClick={() => setView(value)}
                className={`inline-flex h-7 w-8 cursor-pointer items-center justify-center rounded-[4px] transition-all ${
                  view === value ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-raised hover:text-fg'
                }`}
              >
                <Icon size={14} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FOLDERS — above the documents, and only for an account that has one.
        * A folder is where the deliverables are rather than a deliverable, so
        * it is neither a document tier nor an asset (lib/shelf's third
        * partition), and `total` still counts documents: making a folder never
        * changes what the shelf says you have. */}
      {shelf.folders.length > 0 && (
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
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shelf.folders.map((row) => (
              <FolderTile key={row.id} row={row} count={inside(row.id)} level={actions} folders={pickable} onDeleted={trash} />
            ))}
          </ul>
        </section>
      )}

      {nothing && filtering && (
        <p aria-label="No matches" className="px-1 font-mono text-xs text-faint">
          nothing matches the active {q ? 'search' : 'filters'}
        </p>
      )}

      {view === 'grid' && shelf.documents.length > 0 && (
        <div aria-label="Artifact grid" className="flex flex-col gap-7">
          {dateGroups.map((group) => (
            <section key={group.key} aria-label={`${group.label} artifacts`}>
              <div className="mb-2.5 flex items-center gap-3 px-0.5">
                <h2 className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-muted">
                  {group.label}
                </h2>
                <span aria-hidden="true" className="h-px flex-1 bg-edge" />
              </div>
              <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {group.rows.map((row) => {
                  const i = shelf.documents.indexOf(row);
                  return (
                    <li
                      key={row.id}
                      className={`reveal group relative flex flex-col overflow-hidden ${PANEL} transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-edge-bright`}
                      style={{ animationDelay: `${Math.min(i * 35, 280)}ms` }}
                    >
                      <div className="relative">
                        <Thumb row={row} className="aspect-[40/21] border-b border-edge" />
                        <CardControls row={row} level={actions} folders={pickable} />
                      </div>
                      <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
                        <a
                          href={row.url}
                          aria-label={`Open ${nameOf(row)}`}
                          className="block truncate font-mono text-[13px] leading-snug font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent"
                        >
                          {row.title ?? 'Untitled'}
                        </a>
                        <div className="mt-auto flex min-w-0 items-center gap-2">
                          {row.views !== undefined && (
                            <ViewsMark name={nameOf(row)} views={row.views} sparkline={row.sparkline} className="flex-1" />
                          )}
                          <Stamp row={row} mode={dates} trailing={row.views !== undefined} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {view === 'list' && shelf.documents.length > 0 && (
        <ArtifactTable
          artifacts={shelf.documents}
          folders={pickable}
          manage={actions === 'full'}
          canEdit={actions === 'full'}
          canShare={actions !== 'none'}
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
            canShare={false}
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
