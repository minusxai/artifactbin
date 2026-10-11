import WorkspaceHeading from '../components/WorkspaceHeading';
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
import { pageDataChanged } from '@/solid/lib/page-data-events';
import { RowMenu } from '../ui/Menu';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';
import { Tooltip } from '../ui/Tooltip';
import { Badge, FormatBadge, formatLabel, timeAgo } from '../ui/ui';
import { usePageData } from '../lib/use-page-data';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';
import { dateTime } from '../lib/format';

interface TrashFile { id: string; title: string | null; format: string; version: number; deleted_at: string }

const ROWS_PER_PAGE = 10;
const FORMAT_ORDER = ['folder', 'markup', 'dataset', 'viz', 'image', 'pdf'];
const HEADINGS = ['title', 'type', 'ver', 'deleted', ''];

function TypeFilter(props: { format: string; active: boolean; onToggle: (format: string) => void }): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      pressed={props.active}
      aria-label={`Filter ${props.format}`}
      onClick={() => props.onToggle(props.format)}
    >
      {formatLabel(props.format)}
    </Button>
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
      <main class="workspace-page">
        <WorkspaceHeading title="Trash" description="Deleted artifacts can be restored." />

        <Panel label="Trash" padding="none">
          <Show when={page.error()}>
            <Button variant="secondary" size="sm" class="m-3" aria-label="Retry trash" onClick={() => void page.refresh(true)}>Could not refresh trash. Retry</Button>
          </Show>
          <div class="flex flex-wrap items-center gap-2 border-b border-edge bg-raised/30 px-4 py-3">
            <SearchField
              label="Search trash"
              placeholder="search artifacts"
              value={query()}
              onValue={(value) => { setQuery(value); setPageIndex(0); }}
              class="min-w-32 flex-1"
            />
            <Show when={formats().length > 1}>
              <span class="ml-auto flex flex-wrap items-center gap-1.5">
                <For each={formats()}>
                  {(format) => <TypeFilter format={format} active={formatPicks().includes(format)} onToggle={toggleFormat} />}
                </For>
              </span>
            </Show>
            <Show when={filtering()}>
              <span class="shrink-0 font-mono text-micro text-faint">{visible().length} / {files().length}</span>
            </Show>
          </div>

          <Table>
            <TableHead class="hidden sm:table-header-group">
              <Index each={HEADINGS}>{(heading) => <TableHeaderCell>{heading()}</TableHeaderCell>}</Index>
            </TableHead>
            <TableBody>
              <Show when={page.data() && visible().length === 0}>
                <TableRow interactive={false}>
                  <TableCell colSpan={5} align="center">
                    <StatusMessage kind="empty" class="justify-center py-10">
                      {q() ? <>nothing matches &ldquo;{query().trim()}&rdquo;</> : formatPicks().length ? 'nothing matches the active filters' : 'nothing deleted'}
                    </StatusMessage>
                  </TableCell>
                </TableRow>
              </Show>
              <For each={rows()}>
                {(file, index) => {
                  const name = () => file.title || 'Untitled';
                  return (
                    <TableRow class="reveal" style={{ 'animation-delay': `${index() * 40}ms` }}>
                      <TableCell class="w-full max-w-0">
                        <span class="block truncate font-semibold text-fg">{name()}</span>
                        <span class="mt-1 flex items-center gap-1.5 font-mono text-micro leading-none text-faint sm:hidden">
                          <span>{formatLabel(file.format)}</span>
                          <span aria-hidden="true">·</span>
                          <span>v{file.version}</span>
                          <span aria-hidden="true">·</span>
                          <time datetime={file.deleted_at}>{timeAgo(file.deleted_at)}</time>
                        </span>
                      </TableCell>
                      <TableCell class="hidden whitespace-nowrap sm:table-cell"><FormatBadge format={file.format} /></TableCell>
                      <TableCell class="hidden whitespace-nowrap sm:table-cell"><Badge tone="dim">v{file.version}</Badge></TableCell>
                      <Tooltip content={dateTime(file.deleted_at)}>
                        <TableCell class="hidden whitespace-nowrap text-xs text-muted sm:table-cell">
                          {timeAgo(file.deleted_at)}
                        </TableCell>
                      </Tooltip>
                      <TableCell align="right" class="whitespace-nowrap">
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
                      </TableCell>
                    </TableRow>
                  );
                }}
              </For>
            </TableBody>
          </Table>

          <Show when={visible().length > ROWS_PER_PAGE}>
            <div class="flex items-center justify-between border-t border-edge px-4 py-2">
              <span aria-label="Page range" class="font-mono text-micro text-faint">
                {start() + 1}-{start() + rows().length} of {visible().length}
              </span>
              <span class="inline-flex items-center gap-1">
                <Tooltip content="previous">
                  <Button variant="secondary" icon type="button" aria-label="Previous page" disabled={currentPage() === 0} onClick={() => setPageIndex(currentPage() - 1)}><ChevronLeft size={13} /></Button>
                </Tooltip>
                <Tooltip content="next">
                  <Button variant="secondary" icon type="button" aria-label="Next page" disabled={currentPage() >= pageCount() - 1} onClick={() => setPageIndex(currentPage() + 1)}><ChevronRight size={13} /></Button>
                </Tooltip>
              </span>
            </div>
          </Show>
        </Panel>
      </main>
    </Show>
  );
}
