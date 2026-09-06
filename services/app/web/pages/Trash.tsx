import {appFetch as fetch} from '@/web/api-origin';
import { ChevronLeft, ChevronRight, RotateCcw, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import RowMenu from '@/components/RowMenu';
import { Tooltip } from '@/components/Tooltip';
import { Badge, FormatBadge, formatLabel, MicroLabel, PANEL, TABLE_ROW, timeAgo } from '@/components/ui';
import { useRefreshable } from '@/lib/navigation';
import { useSession } from '../session';

interface TrashFile { id: string; title: string | null; format: string; version: number; deleted_at: string }

const ROWS_PER_PAGE = 10;
const FORMAT_ORDER = ['folder', 'markup', 'dataset', 'viz', 'image', 'pdf'];
const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors';

function TypeFilter({ format, active, onToggle }: { format: string; active: boolean; onToggle: (format: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`Filter ${format}`}
      aria-pressed={active}
      onClick={() => onToggle(format)}
      className={`inline-flex cursor-pointer items-center rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap transition-colors ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-edge bg-transparent text-faint hover:border-edge-bright hover:text-muted'
      }`}
    >
      {formatLabel(format)}
    </button>
  );
}

/**
 * THE TRASH — what this account has deleted and not yet lost.
 *
 * Everything a document normally offers (open, share, export) is exactly what
 * a deleted document must not offer — every read of it is the uniform 404 —
 * so the row menu contains only the one verb that makes it a document again.
 * The table deliberately shares the shelf's visual grammar: Trash is another
 * file collection, not a separate administrative product.
 */
export function TrashPage() {
  const { session } = useSession();
  const [data, setData] = useState<{ files: TrashFile[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [formatPicks, setFormatPicks] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const load = useCallback(() => {
    void fetch('/api/page/trash', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => null);
  }, []);
  useEffect(load, [load]);
  useRefreshable(load);

  const restore = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/my/artifacts/${id}/restore`, { method: 'POST', credentials: 'same-origin' });
      if (response.ok) setData((current) => current ? { files: current.files.filter((file) => file.id !== id) } : current);
    } finally {
      setBusy(null);
    }
  };

  if (session && !session.user) return <Navigate to="/login?callbackUrl=/trash" replace />;
  const files = data?.files ?? [];
  const formats = FORMAT_ORDER.filter((format) => files.some((file) => file.format === format));
  const q = query.trim().toLowerCase();
  const filtering = Boolean(q) || formatPicks.length > 0;
  const visible = filtering
    ? files.filter((file) =>
        (!q || `${file.title ?? ''} ${formatLabel(file.format)}`.toLowerCase().includes(q))
        && (formatPicks.length === 0 || formatPicks.includes(file.format)))
    : files;
  const pageCount = Math.max(1, Math.ceil(visible.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * ROWS_PER_PAGE;
  const rows = visible.slice(start, start + ROWS_PER_PAGE);
  const toggleFormat = (format: string) => {
    setFormatPicks((picks) => picks.includes(format) ? picks.filter((pick) => pick !== format) : [...picks, format]);
    setPage(0);
  };

  return (
    <main className="mx-auto mt-8 max-w-6xl px-4 pb-24 sm:px-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <MicroLabel>trash</MicroLabel>
        <span className="font-mono text-[10px] text-faint">deleted artifacts can be restored</span>
      </div>

      <section aria-label="Trash" className={PANEL}>
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            aria-label="Search trash"
            placeholder="search artifacts"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            className="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
          />
          {formats.length > 1 && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 border-l border-edge pl-2">
              {formats.map((format) => (
                <TypeFilter key={format} format={format} active={formatPicks.includes(format)} onToggle={toggleFormat} />
              ))}
            </span>
          )}
          {filtering && (
            <span className="shrink-0 font-mono text-[10px] text-faint">{visible.length} / {files.length}</span>
          )}
        </div>

        <table className="w-full border-collapse text-left text-sm">
          <thead className="hidden sm:table-header-group">
            <tr>
              {['title', 'type', 'ver', 'deleted', ''].map((heading, index) => (
                <th key={index} className="px-4 py-2.5"><MicroLabel>{heading}</MicroLabel></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data && visible.length === 0 && (
              <tr className={TABLE_ROW}>
                <td colSpan={5} className="px-4 py-6 text-center font-mono text-xs text-faint">
                  {q ? <>nothing matches &ldquo;{query.trim()}&rdquo;</> : formatPicks.length ? 'nothing matches the active filters' : 'nothing deleted'}
                </td>
              </tr>
            )}
            {rows.map((file, index) => {
              const name = file.title || 'Untitled';
              return (
                <tr key={file.id} className={`${TABLE_ROW} reveal`} style={{ animationDelay: `${index * 40}ms` }}>
                  <td className="w-full max-w-0 px-3 py-3 sm:px-4 sm:py-2.5">
                    <span className="block truncate font-semibold text-fg">{name}</span>
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] leading-none text-faint sm:hidden">
                      <span>{formatLabel(file.format)}</span>
                      <span aria-hidden="true">·</span>
                      <span>v{file.version}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={file.deleted_at} suppressHydrationWarning>{timeAgo(file.deleted_at)}</time>
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell"><FormatBadge format={file.format} /></td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell"><Badge tone="dim">v{file.version}</Badge></td>
                  <Tooltip content={new Date(file.deleted_at).toLocaleString()}>
                    <td className="hidden px-4 py-2.5 text-xs whitespace-nowrap text-muted sm:table-cell" suppressHydrationWarning>
                      {timeAgo(file.deleted_at)}
                    </td>
                  </Tooltip>
                  <td className="px-2 py-3 text-right whitespace-nowrap sm:px-4 sm:py-2.5">
                    <RowMenu
                      name={name}
                      items={[{
                        label: `Restore ${name}`,
                        text: busy === file.id ? 'restoring…' : 'restore',
                        icon: <RotateCcw size={12} />,
                        disabled: busy === file.id,
                        onSelect: () => void restore(file.id),
                      }]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length > ROWS_PER_PAGE && (
          <div className="flex items-center justify-between border-t border-edge px-4 py-2">
            <span aria-label="Page range" className="font-mono text-[10px] text-faint">
              {start + 1}-{start + rows.length} of {visible.length}
            </span>
            <span className="inline-flex items-center gap-1">
              <Tooltip content="previous">
                <button
                  type="button"
                  className={`${ICON_ACTION} enabled:hover:text-accent disabled:cursor-default disabled:text-faint disabled:opacity-40`}
                  aria-label="Previous page"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={13} />
                </button>
              </Tooltip>
              <Tooltip content="next">
                <button
                  type="button"
                  className={`${ICON_ACTION} enabled:hover:text-accent disabled:cursor-default disabled:text-faint disabled:opacity-40`}
                  aria-label="Next page"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight size={13} />
                </button>
              </Tooltip>
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
