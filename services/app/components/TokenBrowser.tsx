'use client';

import { ChevronDown, ChevronLeft, ChevronRight, Folder, EyeOff, FolderInput, Globe, Lock, Pencil, Search, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Tooltip } from '@/components/Tooltip';
import { Badge, Button, dateStamp, FormatBadge, formatLabel, MicroLabel, PANEL, TABLE_ROW, timeAgo, TokenInput, VisibilityPill } from '@/components/ui';
import { ViewsMark } from '@/components/ViewsMark';
import ShareLink from '@/components/ShareLink';
import RowMenu, { confirmDeleteArtifact } from '@/components/RowMenu';
import { MoveMenu, type PickerFolder } from '@/components/FolderPicker';
import { parentOfRow } from '@/lib/shelf';
import { adoptToken } from '@/lib/browser-session';
import type { Visibility } from '@/lib/artifacts';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';

interface ArtifactSummary {
  id: string;
  url: string;
  title: string | null;
  format?: string;
  version: number;
  /** The id of the folder artifact this row sits in; absent/null = the root. */
  parent_id?: string | null;
  /** The trail root->parent, so a folder's own subtree can be greyed in the picker. */
  ancestor_ids?: string[];
  visibility?: Visibility;
  updated_at: string;
  /** All-time view count; present on dashboard (session) rows only. */
  views?: number;
  /** Server-rendered 30-day view spline (inline SVG markup), when there is anything to draw. */
  sparkline?: string;
}

const VISIBILITY_TIPS: Record<Visibility, string> = {
  public: 'anyone with the link · listed on your public profile',
  unlisted: 'anyone with the link · not listed anywhere',
  private: 'only you and invited emails',
};

/** Canonical chip order — chips are derived from the rows, these fix their sequence. */
const FORMAT_ORDER = ['markup', 'dataset', 'viz', 'image', 'pdf'];
const VISIBILITY_ORDER: Visibility[] = ['public', 'unlisted', 'private'];

const VISIBILITY_GLYPHS: Record<Visibility, React.ReactNode> = {
  public: <Globe size={10} />,
  unlisted: <EyeOff size={10} />,
  private: <Lock size={10} />,
};

/** Multi-select quick-filter pill. Pressed state is the whole contract. */
function FilterChip({ value, label, active, onToggle, tip, children }: {
  value: string;
  label?: string;
  active: boolean;
  onToggle: (value: string) => void;
  tip?: string;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip content={tip ?? ''} disabled={!tip}>
      <button
        type="button"
        aria-label={`Filter ${value}`}
        aria-pressed={active}
        onClick={() => onToggle(value)}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap transition-colors ${
          active
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-edge bg-transparent text-faint hover:border-edge-bright hover:text-muted'
        }`}
      >
        {children}
        {label ?? value}
      </button>
    </Tooltip>
  );
}

/**
 * Logged-out fallback: paste a bearer token, see that token's artifacts.
 *
 * The token is handed to the SERVER (POST /api/session/token) and comes back
 * as an httpOnly cookie; this component never keeps it, and on a later visit
 * the list simply loads because the cookie is already there. httpOnly is the
 * point: no script on the origin can read the credential back.
 */
export default function TokenBrowser() {
  const [token, setToken] = useState('');
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** List what the cookie authorizes. `quiet` = the on-mount probe, which must
   *  say nothing when this browser simply holds no token. */
  const load = useCallback(async (quiet = false) => {
    setError(null);
    try {
      const res = await fetch('/api/my/artifacts');
      if (res.status === 401) {
        setArtifacts(null);
        if (!quiet) setError('Invalid or revoked token.');
        return;
      }
      if (!res.ok) {
        setArtifacts(null);
        if (!quiet) setError(`Failed to load (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { artifacts: ArtifactSummary[] };
      setArtifacts(body.artifacts);
    } catch {
      // A probe that cannot even run — offline, or a test environment with no
      // document origin for a relative fetch — is "nothing listed", never an
      // unhandled rejection that crashes the mount.
      setArtifacts(null);
      if (!quiet) setError('Could not reach the server.');
    }
  }, []);

  const submit = useCallback(async (t: string) => {
    setError(null);
    if (!(await adoptToken(t))) {
      setArtifacts(null);
      setError('Invalid or revoked token.');
      return;
    }
    setToken('');
    await load();
  }, [load]);

  useEffect(() => { void load(true); }, [load]);

  return (
    <section className="mt-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) void submit(token.trim());
        }}
      >
        <TokenInput
          aria-label="Token"
          placeholder="mx_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Button type="submit" aria-label="Load artifacts">
          load
        </Button>
      </form>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      {artifacts && artifacts.length === 0 && <p className="mt-3 text-xs text-muted">No artifacts yet.</p>}
      {artifacts && artifacts.length > 0 && (
        <div className="mt-4">
          <ArtifactTable artifacts={artifacts} />
        </div>
      )}
    </section>
  );
}

/** Icon-only row action — the label lives in the tooltip, not the row. */
const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors';

/**
 * Rows per page when this table IS the list (the logged-out token browser):
 * one block in a taller page, which must not grow into everything below it.
 *
 * In a shelf's list view the count is raised (SHELF_LIST_PER_PAGE), because
 * rows are compact and cheap. Five is also below the count at which a pager helps anyone: it
 * costs a click to reveal what a little scrolling would have shown, which is
 * most of why the old dashboard list read as small.
 */
export const ARTIFACTS_PER_PAGE = 5;

/** `manage` enables the session-scoped delete — dashboard only. History lives in the page's edit mode. */
export function ArtifactTable({ artifacts, treeRows, includeAssets = true, folders, manage, embedded, canEdit = true, showVisibility = true, showViews = true, filtersInline = false, dates = 'relative', perPage = ARTIFACTS_PER_PAGE, searchLabel = 'Search artifacts', searchPlaceholder = 'search artifacts' }: {
  artifacts: ArtifactSummary[];
  /** Complete local inventory for expandable folder rows; pagination counts roots. */
  treeRows?: ArtifactSummary[];
  includeAssets?: boolean;
  /**
   * The account's folders, for the move picker. A scoped table may contain
   * only part of the tree, so the shelf supplies the complete folder list.
   */
  folders?: PickerFolder[];
  manage?: boolean;
  /**
   * Whether a row may be opened in the editor. Separate from `manage` because
   * a PROFILE offers the link and nothing that changes the document, while the
   * logged-out token browser has always offered editing without the owner's
   * move/delete menu — two different subsets, so one boolean cannot say both.
   */
  canEdit?: boolean;
  showVisibility?: boolean;
  /** Whether analytics telemetry belongs in this table's job. */
  showViews?: boolean;
  /** Keep quick filters in the search rail instead of spending a second row. */
  filtersInline?: boolean;
  /** Relative on the owner's surfaces, absolute on a profile — see ShelfProps. */
  dates?: 'relative' | 'absolute';
  /** Rows before a pager appears. */
  perPage?: number;
  /** A standalone collection names its own search domain. */
  searchLabel?: string;
  searchPlaceholder?: string;
  /**
   * Rendered as the list view of a `<Shelf>`, which owns the search box and
   * has already narrowed these rows. Suppresses this component's own search
   * header and filter chips so the page never carries two of either — the
   * rows, the actions and the pager are the part being reused.
   */
  embedded?: boolean;
}) {
  // Folder moves land as local overrides — a metadata PATCH is too small a
  // change to justify reloading the page the way delete does.
  const [movedFolders, setMovedFolders] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadedChildren, setLoadedChildren] = useState<Record<string, ArtifactSummary[]>>({});
  const [folderStatus, setFolderStatus] = useState<Record<string, 'loading' | 'error'>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const inventory = [...new Map([...Object.values(loadedChildren).flat(), ...(treeRows ?? artifacts)]
    .map((row) => [row.id, row])).values()];
  const childrenOf = (id: string) => inventory
    .filter((row) => (movedFolders[row.id] ?? parentOfRow(row)) === id && (includeAssets || row.format === 'folder' || row.format === 'markup'))
    .sort((a, b) => Number(b.format === 'folder') - Number(a.format === 'folder') || b.updated_at.localeCompare(a.updated_at));
  const toggleFolder = async (id: string) => {
    if (expanded.has(id)) {
      setExpanded((current) => { const next = new Set(current); next.delete(id); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(id));
    if (childrenOf(id).length || loadedChildren[id] || folderStatus[id] === 'loading') return;
    setFolderStatus((current) => ({ ...current, [id]: 'loading' }));
    try {
      const response = await fetch(`/api/page/artifact/${id}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Folder unavailable');
      const page = await response.json();
      if (!Array.isArray(page?.folder?.rows)) throw new Error('Folder unavailable');
      setLoadedChildren((current) => ({ ...current, [id]: page.folder.rows.map((row: ArtifactSummary) => ({ ...row, parent_id: id })) }));
      setFolderStatus((current) => { const next = { ...current }; delete next[id]; return next; });
    } catch {
      setFolderStatus((current) => ({ ...current, [id]: 'error' }));
    }
  };
  const saveTitle = async (a: ArtifactSummary) => {
    const title = draftTitle.trim();
    setRenamingId(null);
    if (!title) return;
    const response = await fetch(`/api/my/artifacts/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }).catch(() => null);
    if (response?.ok) setTitles((current) => ({ ...current, [a.id]: title }));
  };
  const [movingId, setMovingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const placeOf = (a: ArtifactSummary) => movedFolders[a.id] ?? parentOfRow(a) ?? '';
  // The tree the picker draws: what the page handed down, else whatever folders
  // are among these rows.
  const pickable: PickerFolder[] = folders
    ?? artifacts.filter((a) => a.format === 'folder').map((a) => ({ id: a.id, title: a.title ?? null, ancestor_ids: a.ancestor_ids ?? [] }));
  // A folder is named, never spelled: the id was only ever a placeholder for
  // the picker that now knows the account's own names.
  const placeName = (id: string): string => pickable.find((f) => f.id === id)?.title ?? id;

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  // Quick filters: empty selection = no constraint. Within a group values OR,
  // the two groups AND — and both compose with the search query. The format
  // group starts on mx-markup (documents are the deliverable; datasets and
  // images are their supporting assets) — only when the group will actually
  // render AND markup rows exist, so an asset-only list is never born empty.
  const [formatPicks, setFormatPicks] = useState<string[]>(() => {
    const formats = new Set(artifacts.map((a) => a.format ?? 'markup'));
    return formats.size >= 2 && formats.has('markup') ? ['markup'] : [];
  });
  const [visibilityPicks, setVisibilityPicks] = useState<string[]>([]);
  const togglePick = (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    set((picks) => (picks.includes(v) ? picks.filter((p) => p !== v) : [...picks, v]));

  // Chips are derived from the rows, so a group with nothing to split on
  // (all one format, or token rows carrying no visibility) shows no dead chips.
  const formatChips = FORMAT_ORDER.filter((f) => artifacts.some((a) => (a.format ?? 'markup') === f));
  const visibilityChips = VISIBILITY_ORDER.filter((v) => artifacts.some((a) => a.visibility === v));
  const showFormatChips = formatChips.length >= 2;
  const showVisibilityChips = visibilityChips.length >= 2;

  // The views column follows the DATA, never the permission: a page that did
  // not ask for counts reserves no column and prints no zero. That is the same
  // rule the shelf's ViewsMark keeps, in the one other place a count renders.
  // The column itself is DESKTOP-only, so the spline's width comes out of the
  // width a phone never had; there, the stacked meta line carries the count
  // with a 12px squash of the same spline beside it.
  const hasViews = showViews && inventory.some((a) => a.views !== undefined);

  const q = query.trim().toLowerCase();
  const filtering = Boolean(q) || formatPicks.length > 0 || visibilityPicks.length > 0;
  const visible = !embedded && filtering
    ? artifacts.filter(
        (a) =>
          (!q || `${a.title ?? ''} ${a.format ?? ''}`.toLowerCase().includes(q)) &&
          (formatPicks.length === 0 || formatPicks.includes(a.format ?? 'markup')) &&
          (visibilityPicks.length === 0 || (a.visibility != null && visibilityPicks.includes(a.visibility))),
      )
    : artifacts;

  // Clamp rather than reset on search: the cursor is only ever read through this
  // derived value, so a filter that shrinks the list under it can't strand the
  // user on an empty page, and clearing the filter puts them back where they were.
  const pageCount = Math.max(1, Math.ceil(visible.length / perPage));
  const current = Math.min(page, pageCount - 1);
  const start = current * perPage;
  const rows = visible.slice(start, start + perPage);
  const displayRows: Array<{ row: ArtifactSummary; depth: number; message?: string }> = [];
  const appendRows = (items: ArtifactSummary[], depth: number, trail: string[] = []) => {
    for (const item of items) {
      if (trail.includes(item.id)) continue;
      const row = { ...item, title: titles[item.id] ?? item.title };
      displayRows.push({ row, depth });
      if (treeRows && row.format === 'folder' && expanded.has(row.id)) {
        const children = childrenOf(row.id);
        appendRows(children, depth + 1, [...trail, row.id]);
        if (!children.length) displayRows.push({ row, depth: depth + 1, message:
          folderStatus[row.id] === 'loading' ? 'Loading…' : folderStatus[row.id] === 'error' ? 'Could not load folder. Collapse and expand to retry.' : 'No items in this folder.' });
      }
    }
  };
  appendRows(rows, 0);
  const hasFilters = showFormatChips || showVisibilityChips;
  const filterControls = (
    <>
      {showFormatChips &&
        formatChips.map((f) => (
          <FilterChip
            key={f}
            value={f}
            label={formatLabel(f)}
            active={formatPicks.includes(f)}
            onToggle={togglePick(setFormatPicks)}
          />
        ))}
      {showFormatChips && showVisibilityChips && <span aria-hidden="true" className="mx-1 h-3 w-px bg-edge" />}
      {showVisibilityChips &&
        visibilityChips.map((v) => (
          <FilterChip
            key={v}
            value={v}
            active={visibilityPicks.includes(v)}
            onToggle={togglePick(setVisibilityPicks)}
            tip={VISIBILITY_TIPS[v]}
          >
            {VISIBILITY_GLYPHS[v]}
          </FilterChip>
        ))}
    </>
  );

  return (
    <div className={PANEL}>
      {!embedded && (
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
        <Search size={13} className="shrink-0 text-faint" />
        <input
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
        />
        {filtersInline && hasFilters && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 border-l border-edge pl-2">
            {filterControls}
          </span>
        )}
        {filtering && (
          <span className="shrink-0 font-mono text-[10px] text-faint">
            {visible.length} / {artifacts.length}
          </span>
        )}
      </div>
      )}
      {!embedded && !filtersInline && hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-edge px-4 py-2">
          {filterControls}
        </div>
      )}
      <table className="w-full border-collapse text-left text-sm">
        <thead className="hidden sm:table-header-group">
          <tr>
            {[
              'title',
              ...(embedded ? [] : ['type']),
              ...(embedded ? [] : ['ver']),
              ...(hasViews ? ['views'] : []),
              'updated',
              '',
            ].map((h, i) => (
              <th key={i} className="px-4 py-2.5">
                <MicroLabel>{h}</MicroLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr className={TABLE_ROW}>
              <td colSpan={(embedded ? 3 : 5) + (hasViews ? 1 : 0)} className="px-4 py-6 text-center font-mono text-xs text-faint">
                {q ? <>nothing matches &ldquo;{query.trim()}&rdquo;</> : 'nothing matches the active filters'}
              </td>
            </tr>
          )}
          {displayRows.map(({ row: a, depth, message }, i) => message ? (
            <tr key={`${a.id}-status`} className={TABLE_ROW}>
              <td colSpan={(embedded ? 3 : 5) + (hasViews ? 1 : 0)} className="px-4 py-3 font-mono text-xs text-faint" style={{ paddingLeft: 16 + depth * 16 }} role="status">{message}</td>
            </tr>
          ) : (
            <tr key={a.id} className={`${TABLE_ROW} reveal`} style={{ animationDelay: `${i * 40}ms` }}>
              {/* w-full + max-w-0 makes this the flexible column: it absorbs
                  the leftover width, so `truncate` on the title actually bites
                  and the badges never wrap onto a second line. */}
              <td className="w-full max-w-0 px-3 py-3 sm:px-4 sm:py-2.5">
                <span className="flex min-w-0 items-center gap-2" style={treeRows ? { paddingLeft: depth * 16 } : undefined}>
                  {treeRows && a.format === 'folder' && <button type="button" aria-label={`${expanded.has(a.id) ? 'Collapse' : 'Expand'} folder ${a.title ?? a.id}`} aria-expanded={expanded.has(a.id)} onClick={() => void toggleFolder(a.id)} className="flex h-6 w-9 shrink-0 cursor-pointer items-center gap-1 text-faint hover:text-accent">
                    {expanded.has(a.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Folder size={16} />
                  </button>}
                  {/* The row's own picture, tiny. A dense list is scanned by
                      SIGHT before it is read, and these rows are the archive —
                      the tier where a title alone is least likely to be
                      recognised. Hidden on a phone, where the width is the
                      scarce thing. */}
                  {(a.format ?? 'markup') === 'markup' && (
                    <span className="relative hidden h-[19px] w-9 shrink-0 overflow-hidden rounded-[2px] border border-edge bg-raised sm:block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/a/${a.id}/export?format=jpg&mode=card&v=${a.version}&r=${CARD_RENDER_GENERATION}`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      {renamingId === a.id ? <input aria-label="Folder name" autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onBlur={() => void saveTitle(a)} onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); void saveTitle(a); }
                        if (event.key === 'Escape') setRenamingId(null);
                      }} className="min-w-0 flex-1 bg-transparent font-semibold text-fg focus:outline-none" /> : <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate font-semibold text-fg no-underline underline-offset-4 hover:underline"
                        aria-label={`Open ${a.format === 'folder' ? 'folder ' : ''}${a.title ?? a.id}`}
                      >
                        {a.title ?? <span className="text-faint">(untitled)</span>}
                      </a>}
                      {treeRows && a.format === 'folder' && childrenOf(a.id).length > 0 && <span className="font-mono text-[10px] text-faint">{childrenOf(a.id).length}</span>}
                      {manage && !treeRows && placeOf(a) && (
                        <span className="shrink-0 font-mono text-[10px] text-faint">{placeName(placeOf(a))}</span>
                      )}
                    </span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[10px] leading-none text-faint sm:hidden">
                      {!embedded && (
                        <>
                          <span>{formatLabel(a.format ?? 'markup')}</span>
                          <span aria-hidden="true">·</span>
                          <span>v{a.version}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      {hasViews && a.format !== 'folder' && (
                        <>
                          <ViewsMark name={a.title ?? a.id} views={a.views ?? 0} sparkline={a.sparkline} className="w-24 shrink-0" />
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <time dateTime={a.updated_at} suppressHydrationWarning>
                        {dates === 'absolute' ? dateStamp(a.updated_at) : timeAgo(a.updated_at)}
                      </time>
                    </span>
                  </span>
                  {/* Every row says who can read it — an unmarked row would
                      read as "unknown" now that the owner toggles visibility.
                      Public gets the louder ink; unlisted and private stay faint. */}
                  {showVisibility && a.visibility && <VisibilityPill compact visibility={a.visibility} name={a.title ?? a.id} />}
                </span>
              </td>
              {/* A shelf's archive contains only markup documents; its type
                  is guaranteed by the tier, so repeating it costs a column
                  without adding information. Standalone tables can mix
                  documents and assets and keep the badge. */}
              {!embedded && (
                <td className="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell">
                  <FormatBadge format={a.format} />
                </td>
              )}
              {!embedded && (
                <td className="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell">
                  <Badge tone="dim">v{a.version}</Badge>
                </td>
              )}
              {hasViews && (
                <td className="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell">
                  {a.format !== 'folder' && <ViewsMark name={a.title ?? a.id} views={a.views ?? 0} sparkline={a.sparkline} className="w-28" />}
                </td>
              )}
              <Tooltip content={new Date(a.updated_at).toLocaleString()}>
                <td
                  className="hidden px-4 py-2.5 text-xs whitespace-nowrap text-muted sm:table-cell"
                  suppressHydrationWarning
                >
                  {dates === 'absolute' ? dateStamp(a.updated_at) : timeAgo(a.updated_at)}
                </td>
              </Tooltip>
              <td className="px-2 py-3 text-right whitespace-nowrap sm:px-4 sm:py-2.5">
                <span className="inline-flex items-center gap-1">
                  {canEdit && a.format !== 'folder' && (
                    <Tooltip content="edit">
                      <a
                        href={`/a/${a.id}#edit`}
                        className={`${ICON_ACTION} no-underline hover:text-accent`}
                        aria-label={`Edit ${a.title ?? a.id}`}
                      >
                        <Pencil size={13} />
                      </a>
                    </Tooltip>
                  )}
                  {manage && (
                    <RowMenu
                      name={a.title ?? a.id}
                      items={[
                        ...(a.format === 'folder' ? [{ label: `Rename ${a.title ?? a.id}`, text: 'rename', icon: <Pencil size={12} />, onSelect: () => { setDraftTitle(a.title ?? ''); setRenamingId(a.id); } }] : []),
                        {
                          label: `Manage sharing for ${a.title ?? a.id}`,
                          text: 'share',
                          icon: <Share2 size={12} />,
                          onSelect: () => setSharingId(a.id),
                        },
                        {
                          label: `Move ${a.title ?? a.id}`,
                          text: 'move to folder',
                          icon: <FolderInput size={12} />,
                          onSelect: () => setMovingId(a.id),
                        },
                        {
                          label: `Delete ${a.title ?? a.id}`,
                          text: 'delete',
                          icon: <Trash2 size={12} />,
                          danger: true,
                          onSelect: () => {
                            void confirmDeleteArtifact(a.id, a.title ?? a.id, a.format === 'folder' ? childrenOf(a.id).length : 0).then((ok) => ok && window.location.reload());
                          },
                        },
                      ]}
                    />
                  )}
                  {manage && sharingId === a.id && (
                    <ShareLink className="" artifactId={a.id} title={a.title} owner format={a.format} url={a.url} variant="dialog" onClose={() => setSharingId(null)} />
                  )}
                  {manage && movingId === a.id && (
                    /* The menu is a positioning ancestor, so the picker hangs
                       under the "…" it was opened from rather than under the
                       row, which on the dense tier is a full table width away. */
                    <span className="relative z-20 inline-flex">
                      <MoveMenu
                        row={{ id: a.id, format: a.format ?? 'markup', parent_id: placeOf(a) || null, ancestor_ids: a.ancestor_ids ?? [] }}
                        folders={pickable}
                        onMoved={(parentId) => setMovedFolders((m) => ({ ...m, [a.id]: parentId ?? '' }))}
                        onClose={() => setMovingId(null)}
                      />
                    </span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length > perPage && (
        <div className="flex items-center justify-between border-t border-edge px-4 py-2">
          <span aria-label="Page range" className="font-mono text-[10px] text-faint">
            {start + 1}-{start + rows.length} of {visible.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <Tooltip content="previous">
              <button
                className={`${ICON_ACTION} enabled:hover:text-accent disabled:cursor-default disabled:text-faint disabled:opacity-40`}
                aria-label="Previous page"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft size={13} />
              </button>
            </Tooltip>
            <Tooltip content="next">
              <button
                className={`${ICON_ACTION} enabled:hover:text-accent disabled:cursor-default disabled:text-faint disabled:opacity-40`}
                aria-label="Next page"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight size={13} />
              </button>
            </Tooltip>
          </span>
        </div>
      )}
    </div>
  );
}
