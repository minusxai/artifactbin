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
import { Check, FolderInput, Link2, Pencil, Search, Trash2 } from 'lucide-react';
import RowMenu, { confirmDeleteArtifact } from '@/components/RowMenu';
import { ArtifactTable } from '@/components/TokenBrowser';
import { Tooltip } from '@/components/Tooltip';
import { dateStamp, MicroLabel, PANEL, Spark, timeAgo, VISIBILITY_TIPS, VisibilityPill } from '@/components/ui';
import { buildShelf, type ShelfItem } from '@/lib/shelf';
import type { Visibility } from '@/lib/artifacts';

/** The superset. Every field past the policy's two is optional by design. */
export interface ShelfRow extends ShelfItem {
  id: string;
  url: string;
  title: string | null;
  description?: string | null;
  version: number;
  visibility?: Visibility;
  folder?: string;
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
function Actions({ row, level }: { row: ShelfRow; level: ShelfActions }) {
  const [copied, setCopied] = useState(false);
  const [moving, setMoving] = useState(false);
  const [folder, setFolder] = useState(row.folder ?? '');
  const [folderDraft, setFolderDraft] = useState(row.folder ?? '');
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
  const moveTo = async () => {
    const next = folderDraft.trim();
    const res = await fetch(`/api/my/artifacts/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: next }),
    }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { folder?: string };
    setFolder(body.folder ?? next);
    setMoving(false);
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
                onSelect: () => {
                  setFolderDraft(folder);
                  setMoving(true);
                },
              },
              {
                label: `Delete ${nameOf(row)}`,
                text: 'delete',
                icon: <Trash2 size={12} />,
                danger: true,
                onSelect: () => {
                  void confirmDeleteArtifact(row.id, nameOf(row)).then((ok) => ok && window.location.reload());
                },
              },
            ]}
          />
        </>
      )}
      {moving && (
        <form
          className="absolute right-0 top-full z-30 mt-1 flex w-56 items-center gap-1 rounded-[6px] border border-edge bg-surface p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void moveTo();
          }}
        >
          <input
            aria-label="Folder path"
            placeholder="folder/subfolder ('' = root)"
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            className="min-w-0 flex-1 rounded-[4px] border border-edge bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
          />
          <Tooltip content="save">
            <button type="submit" aria-label="Save folder" className={ICON_ACTION}>
              <Check size={12} />
            </button>
          </Tooltip>
        </form>
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
function CardControls({ row, level }: { row: ShelfRow; level: ShelfActions }) {
  if (!row.visibility && level === 'none') return null;
  return (
    <div
      aria-label={`${nameOf(row)} card controls`}
      className="absolute inset-x-2.5 top-2.5 z-10 flex items-start justify-between gap-2"
    >
      <VisibilityTag row={row} overlay />
      {level !== 'none' && (
        <div className={`${CARD_ACTION_SURFACE} ml-auto`}>
          <Actions row={row} level={level} />
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
        src={`/a/${row.id}/export?format=jpg&mode=card&v=${row.version}`}
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

export default function Shelf({ rows, actions = 'none', assets = true, dates = 'relative', cards = 3 }: ShelfProps) {
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<string[]>([]);
  const q = query.trim().toLowerCase();

  const togglePick = (v: string) => setPicks((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  // Chips are derived from the rows, so a shelf with nothing to split on shows
  // no dead controls.
  const chips = VISIBILITY_ORDER.filter((v) => rows.some((r) => r.visibility === v));
  const showChips = chips.length >= 2;

  const shelf = useMemo(() => {
    const matched = rows.filter(
      (r) =>
        (!q || `${r.title ?? ''} ${r.description ?? ''} ${r.format}`.toLowerCase().includes(q)) &&
        (picks.length === 0 || (r.visibility != null && picks.includes(r.visibility))),
    );
    // A text QUERY flattens; a visibility filter does not. Search is finding,
    // and its results are already ordered by what was asked for. Filtering is
    // still browsing — a narrower shelf is a shelf.
    return buildShelf(matched, { cards, flat: Boolean(q) });
  }, [rows, q, picks, cards]);

  const filtering = Boolean(q) || picks.length > 0;
  const nothing = !shelf.hero && shelf.cards.length === 0 && shelf.list.length === 0 && shelf.assets.length === 0;

  return (
    <section aria-label="Shelf" className="flex flex-col gap-5">
      {rows.length > 0 && (
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
                {shelf.total + shelf.assets.length}/{rows.length}
              </span>
            )}
          </div>
        </div>
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
          <CardControls row={shelf.hero} level={actions} />
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
                <CardControls row={row} level={actions} />
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
