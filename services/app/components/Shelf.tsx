'use client';

/**
 * THE SHELF — one presentation for three queries.
 *
 * `/` (the dashboard), `/@me` (the owner's profile root) and `/@them` (a
 * stranger's) are different QUESTIONS about who owns what; they are the same
 * ANSWER on screen. This component is that answer, and it fetches nothing:
 * each page runs its own query and hands over rows plus what the viewer may
 * do with them.
 *
 * The capability props are the seam. A profile passes no `views`, so no
 * spline is drawn and no column is reserved — OPTIONAL FIELDS DEGRADE, which
 * is the whole test of whether the seam is in the right place. If adding view
 * counts to the dashboard required touching the profile, this would be the
 * wrong shape.
 *
 * Tiering policy lives in `lib/shelf` (pure). This file only renders it, and
 * hands the dense tier to `ArtifactTable`, which already owns row actions and
 * paging.
 */
import { useMemo, useState } from 'react';
import { Check, Folder, FolderInput, FolderPlus, Link2, Pencil, Search, Trash2 } from 'lucide-react';
import RowMenu, { confirmDeleteArtifact } from '@/components/RowMenu';
import { MoveMenu, type PickerFolder } from '@/components/FolderPicker';
import { ArtifactTable } from '@/components/TokenBrowser';
import { Tooltip } from '@/components/Tooltip';
import { dateStamp, MicroLabel, PANEL, Spark, timeAgo, VISIBILITY_TIPS, VisibilityPill } from '@/components/ui';
import { buildShelf, parentOfRow, type ShelfItem } from '@/lib/shelf';
import type { Visibility } from '@/lib/artifacts';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';

/** The superset. Every field past the policy's two is optional by design. */
export interface ShelfRow extends ShelfItem {
  id: string;
  url: string;
  title: string | null;
  description?: string | null;
  version: number;
  visibility?: Visibility;
  /** The id of the folder artifact this row sits in; absent/null = the root. */
  parent_id?: string | null;
  /** The trail root->parent, so a folder's own subtree can be greyed in the picker. */
  ancestor_ids?: string[];
  views?: number;
  /** Server-rendered 30-day spline (inline SVG). Absent = draw none. */
  sparkline?: string;
}

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
  /** Thumbnail-tier size. */
  cards?: number;
  /**
   * WHERE A FOLDER MADE HERE GOES — the folder being viewed, or null at the
   * dashboard root. It is the wire's own `parent_id`, so null is the root and
   * an absent value is never "leave it".
   */
  parentId?: string | null;
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
  return (
    <li className={`reveal group relative flex items-center gap-2 px-3 py-2.5 ${PANEL} transition-colors hover:border-edge-bright`}>
      <Folder size={14} className="shrink-0 text-faint transition-colors group-hover:text-accent" />
      {/* A STRETCHED LINK: the whole tile opens the folder, while the actions
          beside it sit above the pseudo-element rather than inside the anchor
          (a <button> in an <a> is invalid markup and swallows its own click). */}
      <a
        href={row.url}
        aria-label={`Open folder ${nameOf(row)}`}
        className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent"
      >
        {row.title ?? row.id}
      </a>
      {/* Only when there IS one. This count is what THIS shelf holds under the
          folder, and a profile's listing is root-scoped (its children are on
          the folder's own page) — so a zero here would be a wrong number
          rather than an empty folder. */}
      {count > 0 && <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">{count}</span>}
      {row.visibility && <VisibilityPill compact visibility={row.visibility} name={nameOf(row)} />}
      <Actions row={row} level={level} folders={folders} childCount={count} onDeleted={onDeleted} />
    </li>
  );
}

/**
 * NEW FOLDER, INLINE — no dialog and no navigation. Enter creates, Escape
 * discards, and the tile appears where the strip already is.
 *
 * The door is the session twin of create (`POST /api/my/artifacts`), which is
 * the same pipeline an agent's `format: 'folder'` goes through: the scaffold is
 * stamped there, in the insert's own transaction, so a folder made from a
 * button and one made from a token are the same row.
 */
function NewFolder({ parentId, onMade }: { parentId: string | null; onMade: (row: ShelfRow) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    const res = await fetch('/api/my/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'folder', title, parent_id: parentId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return;
    const body = (await res.json().catch(() => null)) as (Partial<ShelfRow> & { id?: string }) | null;
    if (!body?.id) return;
    const now = new Date().toISOString();
    onMade({
      ...body,
      id: body.id,
      url: body.url ?? `/a/${body.id}`,
      title: body.title ?? title,
      format: 'folder',
      version: body.version ?? 1,
      // Born private like any owned artifact — said here only so the tile can
      // classify itself before the page is next loaded from the server.
      visibility: body.visibility ?? 'private',
      updated_at: body.updated_at ?? now,
      parent_id: body.parent_id ?? parentId,
    });
    setName('');
    setNaming(false);
  };

  if (!naming) {
    return (
      <Tooltip content="a folder is an artifact — it gets a link, sharing and versions like any other">
        <button
          type="button"
          aria-label="New folder"
          onClick={() => setNaming(true)}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-edge bg-transparent px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <FolderPlus size={12} /> new folder
        </button>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <input
        aria-label="Folder name"
        placeholder="folder name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void create();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setName('');
            setNaming(false);
          }
        }}
        className="w-36 rounded-[4px] border border-edge bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
      />
      <span className="font-mono text-[10px] text-faint">enter</span>
    </span>
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
 * Copy-link and edit, on EVERY tier.
 *
 * The tiers differ in weight, never in capability — needing to hunt for a
 * document in the dense rows to reach its editor would make the hero a
 * downgrade for the one document you are most likely to want.
 *
 * `relative z-10` is load-bearing: the card body is a STRETCHED LINK (an
 * anchor whose ::after covers the whole card), because a <button> nested
 * inside an <a> is invalid markup and swallows its own click. These sit above
 * that pseudo-element instead of inside the anchor.
 */
function Actions({ row, level, folders, childCount = 0, onDeleted }: { row: ShelfRow; level: ShelfActions; folders: PickerFolder[]; childCount?: number; onDeleted?: (id: string) => void }) {
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
          <Tooltip content="edit">
            <a aria-label={`Edit ${nameOf(row)}`} href={`/a/${row.id}#edit`} className={`${ICON_ACTION} no-underline`}>
              <Pencil size={13} />
            </a>
          </Tooltip>
          <RowMenu
            name={nameOf(row)}
            items={[
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
                // out of for 30 days (lib/trash).
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

/**
 * Views + spline, or NOTHING. The old table printed `views ?? 0`, which told a
 * profile visitor that a document had zero readers when the truth was that
 * nobody had counted for them. The fluid-SVG mechanics live in ui's Spark —
 * the table draws the same mark at other sizes.
 */
function ViewsMark({ row, spline = true, filled = true }: { row: ShelfRow; spline?: boolean; filled?: boolean }) {
  if (row.views === undefined) return null;
  return (
    <Tooltip content="views · spline is the last 30 days">
      <span aria-label={`${nameOf(row)} views`} className="flex min-w-0 flex-1 items-center gap-2">
        {/* Count FIRST, and it says what it counts: with the spline between
            them the bare count landed beside the timestamp and "1 · 5 hrs ago"
            read as "1 5 hrs"; "1 view" cannot be misread. */}
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
          {row.views} view{row.views === 1 ? '' : 's'}
        </span>
        {spline && row.sparkline && (
          <Spark svg={row.sparkline} filled={filled} className="h-5 min-w-0 flex-1" />
        )}
      </span>
    </Tooltip>
  );
}

function Stamp({ row, mode }: { row: ShelfRow; mode: 'relative' | 'absolute' }) {
  return (
    <Tooltip content={new Date(row.updated_at).toLocaleString()}>
      <time
        aria-label={`${nameOf(row)} updated`}
        dateTime={row.updated_at}
        suppressHydrationWarning
        className="ml-auto shrink-0 font-mono text-[11px] whitespace-nowrap text-muted"
      >
        {mode === 'absolute' ? dateStamp(row.updated_at) : timeAgo(row.updated_at)}
      </time>
    </Tooltip>
  );
}

/** Document tiers already guarantee `markup`; visibility is the only
 * classification that adds information here. */
function VisibilityTag({ row, overlay = false }: { row: ShelfRow; overlay?: boolean }) {
  return row.visibility ? <VisibilityPill visibility={row.visibility} name={nameOf(row)} overlay={overlay} /> : null;
}

/** The artifact's own og card — one lazily-rendered image serves unfurls and this grid alike. */
function Thumb({ row, className }: { row: ShelfRow; className: string }) {
  return (
    <span className={`relative block w-full overflow-hidden bg-raised ${className}`}>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-edge-bright border-t-accent" />
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
 * The dense tier's page size. The hero and cards already carry what is recent,
 * so these are the archive — and a row is cheap where a thumbnail is not.
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

export default function Shelf({ rows, actions = 'none', assets = true, dates = 'relative', cards = 3, parentId = null }: ShelfProps) {
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<string[]>([]);
  /*
   * Folders MADE HERE, kept beside the page's own rows. Creating one is a
   * metadata-sized act on a page that is otherwise a listing — reloading to
   * show it would throw away the search, the filters and the scroll for a
   * single new tile. The page's next load has it from the server.
   */
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
  const q = query.trim().toLowerCase();
  const present = trashed.length
    ? rows.filter((r) => !trashed.includes(r.id) && !(r.ancestor_ids ?? []).some((a) => trashed.includes(a)))
    : rows;
  const all = made.length ? [...made, ...present] : present;

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
    // A text QUERY flattens; a visibility filter does not. Search is finding,
    // and its results are already ordered by what was asked for. Filtering is
    // still browsing — a narrower shelf is a shelf.
    return buildShelf(matched, { cards, flat: Boolean(q) });
  }, [all, q, picks, cards]);

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

  const filtering = Boolean(q) || picks.length > 0;
  const canMakeFolders = actions === 'full';
  const nothing = !shelf.hero && shelf.cards.length === 0 && shelf.list.length === 0 && shelf.assets.length === 0;

  return (
    <section aria-label="Shelf" className="flex flex-col gap-5">
      {(all.length > 0 || canMakeFolders) && (
        <div className={PANEL}>
          {/* WRAPS, and the field has a floor: three visibility chips beside
              the input left it ~130px on a phone, truncating its own
              placeholder mid-word. Chips take a second line instead. */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Search size={13} className="shrink-0 text-faint" />
            <input
              aria-label="Search artifacts"
              placeholder="search artifacts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
            />
            {showChips && (
              <span className="flex shrink-0 items-center gap-1.5 border-edge sm:ml-auto sm:border-l sm:pl-2">
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
            {canMakeFolders && (
              <span className="shrink-0 border-edge sm:border-l sm:pl-2">
                <NewFolder parentId={parentId} onMade={(row) => setMade((m) => [row, ...m])} />
              </span>
            )}
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

      {/* TIER 1 — full width, because it is almost always the one you came back
        * for. The label pins to the TOP of the column and the classification
        * to the bottom, so the title owns the middle and the eye lands there
        * first; a flat row of equal-weight chips beside it read as noise. */}
      {shelf.hero && (
        <article className={`reveal group relative grid grid-cols-1 overflow-hidden md:grid-cols-[1.35fr_1fr] ${PANEL} transition-colors hover:border-edge-bright`}>
          <div className="relative">
            <Thumb row={shelf.hero} className="aspect-[40/21] border-b border-edge md:h-full md:border-r md:border-b-0" />
          </div>
          {/* On the CARD, not the picture — the hero alone is two columns, so
              its far corner is the right column's, where the actions belong.
              Stacked (phone) the card's top IS the picture's top: same corner
              as every tier below, still no breakpoint fork. */}
          <CardControls row={shelf.hero} level={actions} folders={pickable} />
          {/* Starts BELOW the control row on desktop, so the title gets the
              column's full width instead of sharing its first line with the
              buttons. On a phone the controls are on the picture — no clearance. */}
          <div className="flex flex-col justify-between gap-4 p-3 md:pt-12">
            <div className="min-w-0">
              <a
                href={shelf.hero.url}
                aria-label={`Open ${nameOf(shelf.hero)} (most recent)`}
                // Clamped at 3, not 1: the hero's right column is mostly air,
                // and a title cut to one line beside that much empty space
                // reads as a bug. Three lines still cannot push the views
                // footer out of the panel the thumbnail sets the height of.
                className="block line-clamp-2 sm:line-clamp-3 text-lg leading-snug font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent"
              >
                {shelf.hero.title ?? <span className="text-faint">(untitled)</span>}
              </a>
              {shelf.hero.description && (
                <p className="mt-1.5 line-clamp-2 font-mono text-xs leading-relaxed text-muted">{shelf.hero.description}</p>
              )}
            </div>
            <div className="flex w-full min-w-0 items-center gap-3 pt-2 sm:pt-3">
              <ViewsMark row={shelf.hero} filled={false} />
              <Stamp row={shelf.hero} mode={dates} />
            </div>
          </div>
        </article>
      )}

      {/* TIER 2 — thumbnails, where the picture is worth its space. */}
      {shelf.cards.length > 0 && (
        <ul aria-label="Recent documents" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shelf.cards.map((row, i) => (
            <li
              key={row.id}
              className={`reveal group relative flex flex-col overflow-hidden ${PANEL} transition-colors hover:border-edge-bright`}
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <div className="relative">
                <Thumb row={row} className="aspect-[40/21] border-b border-edge" />
                <CardControls row={row} level={actions} folders={pickable} />
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-3">
                <a
                  href={row.url}
                  aria-label={`Open ${nameOf(row)}`}
                  className="block line-clamp-2 sm:line-clamp-1 font-mono text-sm font-semibold text-fg no-underline transition-colors after:absolute after:inset-0 group-hover:text-accent"
                >
                  {row.title ?? 'Untitled'}
                </a>
                <div className="mt-auto flex min-w-0 items-center gap-2">
                  <ViewsMark row={row}/>
                  <Stamp row={row} mode={dates} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* TIER 3 — dense rows, and the only tier that pages. */}
      {shelf.list.length > 0 && (
        <ArtifactTable
          artifacts={shelf.list}
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
