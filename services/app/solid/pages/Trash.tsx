/* @jsxImportSource solid-js */
/**
 * THE TRASH — what this account has deleted and not yet lost.
 *
 * A Solid component body runs ONCE, so every derived value is an accessor or a memo; reading a signal at the top level
 * (outside JSX, a memo or an effect) would freeze its first value.
 */
import { createMemo, createSignal, For, Index, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import ChevronLeft from 'lucide-solid/icons/chevron-left';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import Search from 'lucide-solid/icons/search';
import { pageDataChanged } from '@/web/page-data-events';
import RowMenu from '../components/RowMenu';
import { Tooltip } from '../components/Tooltip';
import { Badge, FormatBadge, formatLabel, MicroLabel, PANEL, TABLE_ROW, timeAgo } from '../components/ui';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';
import { dateTime } from '../lib/format';

interface TrashFile { id: string; title: string | null; format: string; version: number; deleted_at: string }

const ROWS_PER_PAGE = 10;
const FORMAT_ORDER = ['folder', 'markup', 'dataset', 'viz', 'image', 'pdf'];
const HEADINGS = ['title', 'type', 'ver', 'deleted', ''];
const ICON_ACTION =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted transition-colors';

function TypeFilter(props: { format: string; active: boolean; onToggle: (format: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`Filter ${props.format}`}
      aria-pressed={props.active}
      onClick={() => props.onToggle(props.format)}
      class={`inline-flex cursor-pointer items-center rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap transition-colors ${
        props.active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-edge bg-transparent text-faint hover:border-edge-bright hover:text-muted'
      }`}
    >
      {formatLabel(props.format)}
    </button>
  );
}

export function TrashPage(): JSX.Element {
  const { session } = useSession();
  const page = usePageData<{ files: TrashFile[] }>('/api/page/trash');
  const [busy, setBusy] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal('');
  const [formatPicks, setFormatPicks] = createSignal<string[]>([]);
  const [pageIndex, setPageIndex] = createSignal(0);

  const restore = async (id: string) => {
    setBusy(id);
    try {
      const response = await apiFetch(`/api/my/artifacts/${id}/restore`, 'POST');
      if (response.ok) { const data = page.data(); if (data) page.seed({ files: data.files.filter((file) => file.id !== id) }); pageDataChanged(); }
    } finally {
      setBusy(null);
    }
  };

  const files = () => page.data()?.files ?? [];
  const formats = createMemo(() => FORMAT_ORDER.filter((format) => files().some((file) => file.format === format)));
  const q = () => query().trim().toLowerCase();
  const filtering = () => Boolean(q()) || formatPicks().length > 0;
  const visible = createMemo(() => {
    if (!filtering()) return files();
    const needle = q(); const picks = formatPicks();
    return files().filter((file) =>
      (!needle || `${file.title ?? ''} ${formatLabel(file.format)}`.toLowerCase().includes(needle))
      && (picks.length === 0 || picks.includes(file.format)));
  });
  const pageCount = () => Math.max(1, Math.ceil(visible().length / ROWS_PER_PAGE));
  const currentPage = () => Math.min(pageIndex(), pageCount() - 1);
  const start = () => currentPage() * ROWS_PER_PAGE;
  const rows = createMemo(() => visible().slice(start(), start() + ROWS_PER_PAGE));
  const toggleFormat = (format: string) => {
    setFormatPicks((picks) => picks.includes(format) ? picks.filter((pick) => pick !== format) : [...picks, format]);
    setPageIndex(0);
  };
  const signedOut = () => { const current = session(); return Boolean(current && !current.user); };

  return (
    <Show when={!signedOut()} fallback={<Navigate href="/login?callbackUrl=/trash" />}>
      <main class="mx-auto mt-8 max-w-6xl px-4 pb-24 sm:px-6">
        <div class="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <MicroLabel>trash</MicroLabel>
          <span class="font-mono text-[10px] text-faint">deleted artifacts can be restored</span>
        </div>

        <section aria-label="Trash" class={PANEL}>
          <Show when={page.error()}>
            <button aria-label="Retry trash" onClick={() => void page.refresh(true)}>Could not refresh trash. Retry</button>
          </Show>
          <div class="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
            <Search size={13} class="shrink-0 text-faint" />
            <input
              aria-label="Search trash"
              placeholder="search artifacts"
              value={query()}
              onInput={(event) => { setQuery(event.currentTarget.value); setPageIndex(0); }}
              class="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none"
            />
            <Show when={formats().length > 1}>
              <span class="ml-auto flex shrink-0 items-center gap-1.5 border-l border-edge pl-2">
                <For each={formats()}>
                  {(format) => <TypeFilter format={format} active={formatPicks().includes(format)} onToggle={toggleFormat} />}
                </For>
              </span>
            </Show>
            <Show when={filtering()}>
              <span class="shrink-0 font-mono text-[10px] text-faint">{visible().length} / {files().length}</span>
            </Show>
          </div>

          <table class="w-full border-collapse text-left text-sm">
            <thead class="hidden sm:table-header-group">
              <tr>
                <Index each={HEADINGS}>{(heading) => <th class="px-4 py-2.5"><MicroLabel>{heading()}</MicroLabel></th>}</Index>
              </tr>
            </thead>
            <tbody>
              <Show when={page.data() && visible().length === 0}>
                <tr class={TABLE_ROW}>
                  <td colspan={5} class="px-4 py-6 text-center font-mono text-xs text-faint">
                    {q() ? <>nothing matches &ldquo;{query().trim()}&rdquo;</> : formatPicks().length ? 'nothing matches the active filters' : 'nothing deleted'}
                  </td>
                </tr>
              </Show>
              <For each={rows()}>
                {(file, index) => {
                  const name = () => file.title || 'Untitled';
                  return (
                    <tr class={`${TABLE_ROW} reveal`} style={{ 'animation-delay': `${index() * 40}ms` }}>
                      <td class="w-full max-w-0 px-3 py-3 sm:px-4 sm:py-2.5">
                        <span class="block truncate font-semibold text-fg">{name()}</span>
                        <span class="mt-1 flex items-center gap-1.5 font-mono text-[10px] leading-none text-faint sm:hidden">
                          <span>{formatLabel(file.format)}</span>
                          <span aria-hidden="true">·</span>
                          <span>v{file.version}</span>
                          <span aria-hidden="true">·</span>
                          <time datetime={file.deleted_at}>{timeAgo(file.deleted_at)}</time>
                        </span>
                      </td>
                      <td class="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell"><FormatBadge format={file.format} /></td>
                      <td class="hidden px-4 py-2.5 whitespace-nowrap sm:table-cell"><Badge tone="dim">v{file.version}</Badge></td>
                      <Tooltip content={dateTime(file.deleted_at)}>
                        <td class="hidden px-4 py-2.5 text-xs whitespace-nowrap text-muted sm:table-cell">
                          {timeAgo(file.deleted_at)}
                        </td>
                      </Tooltip>
                      <td class="px-2 py-3 text-right whitespace-nowrap sm:px-4 sm:py-2.5">
                        <RowMenu
                          name={name()}
                          items={[{
                            label: `Restore ${name()}`,
                            text: busy() === file.id ? 'restoring…' : 'restore',
                            icon: () => <RotateCcw size={12} />,
                            disabled: busy() === file.id,
                            onSelect: () => void restore(file.id),
                          }]}
                        />
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>

          <Show when={visible().length > ROWS_PER_PAGE}>
            <div class="flex items-center justify-between border-t border-edge px-4 py-2">
              <span aria-label="Page range" class="font-mono text-[10px] text-faint">
                {start() + 1}-{start() + rows().length} of {visible().length}
              </span>
              <span class="inline-flex items-center gap-1">
                <Tooltip content="previous">
                  <button
                    type="button"
                    class={`${ICON_ACTION} enabled:hover:text-accent disabled:cursor-default disabled:text-faint disabled:opacity-40`}
                    aria-label="Previous page"
                    disabled={currentPage() === 0}
                    onClick={() => setPageIndex(currentPage() - 1)}
                  >
                    <ChevronLeft size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="next">
                  <button
                    type="button"
                    class={`${ICON_ACTION} enabled:hover:text-accent disabled:cursor-default disabled:text-faint disabled:opacity-40`}
                    aria-label="Next page"
                    disabled={currentPage() >= pageCount() - 1}
                    onClick={() => setPageIndex(currentPage() + 1)}
                  >
                    <ChevronRight size={13} />
                  </button>
                </Tooltip>
              </span>
            </div>
          </Show>
        </section>
      </main>
    </Show>
  );
}
