/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { WorkspaceSharedItem } from '@/lib/workspace';
import { SHARE_ROLE_LABEL, SHARE_ROLES } from '@artifactbin/contracts';
import { FormatBadge, formatLabel, LINK, MicroLabel, timeAgo } from '../ui/ui';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/Field';
import { ListRow, Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';
import { artifactLink } from '../lib/artifact-link';

const FORMAT_ORDER = ['markup', 'dataset', 'viz', 'image', 'pdf'];
/** `query`: Home's own "search artifacts" box, ANDed with this panel's own — typing there filters
 * both shelves at once, and this panel's box still narrows further within that result. */
export default function SharedWithYou(props: { items: WorkspaceSharedItem[]; query?: string }): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [formatPicks, setFormatPicks] = createSignal<string[]>([]);
  const [rolePicks, setRolePicks] = createSignal<string[]>([]);
  const toggle = (kind: 'format' | 'role', value: string) => { const set = kind === 'format' ? setFormatPicks : setRolePicks; set(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]); };
  const formats = createMemo(() => { const present = new Set<string>(props.items.map(item => item.format ?? 'markup')); return [...FORMAT_ORDER.filter(format => present.has(format)), ...[...present].filter(format => !FORMAT_ORDER.includes(format))]; });
  const roles = createMemo(() => SHARE_ROLES.filter(role => props.items.some(item => item.role === role)));
  const outer = () => (props.query ?? '').trim().toLowerCase();
  const q = () => query().trim().toLowerCase();
  const filtering = () => Boolean(outer() || q() || formatPicks().length || rolePicks().length);
  const visible = createMemo(() => props.items.filter(item => {
    const format = item.format ?? 'markup';
    const searchable = [item.title, item.description, item.id, item.owner_username ? `@${item.owner_username}` : null, formatLabel(format), SHARE_ROLE_LABEL[item.role]].filter(Boolean).join(' ').toLowerCase();
    return (!outer() || searchable.includes(outer())) && (!q() || searchable.includes(q())) && (!formatPicks().length || formatPicks().includes(format)) && (!rolePicks().length || rolePicks().includes(item.role));
  }));
  return <Show when={props.items.length}><section aria-label="Shared with you" class="mt-8"><div class="mb-2"><MicroLabel>shared with you</MicroLabel></div>
    <Panel padding="none">
      <div class="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
        <SearchField class="min-w-32 flex-1" label="Search shared artifacts" value={query()} onValue={setQuery} />
        <Show when={formats().length >= 2 || roles().length >= 2}><span class="flex shrink-0 flex-wrap items-center gap-1.5 border-edge sm:ml-auto sm:border-l sm:pl-2">
          <Show when={formats().length >= 2}><For each={formats()}>{format => <Button size="sm" variant="ghost" aria-label={`Filter ${format}`} pressed={formatPicks().includes(format)} onClick={() => toggle('format', format)}>{formatLabel(format)}</Button>}</For></Show>
          <Show when={roles().length >= 2}><For each={roles()}>{role => <Button size="sm" variant="ghost" aria-label={`Filter ${role}`} pressed={rolePicks().includes(role)} onClick={() => toggle('role', role)}>{SHARE_ROLE_LABEL[role]}</Button>}</For></Show>
        </span></Show>
        <Show when={filtering()}><span class="shrink-0 border-l border-edge pl-2 font-mono text-micro text-faint">{visible().length}/{props.items.length}</span></Show>
      </div>
      <ul class="m-0 list-none px-3 p-0 font-mono text-xs">
        <Show when={visible().length === 0}><li class="py-6"><StatusMessage kind="empty" class="justify-center">{q() ? <>nothing matches &ldquo;{query().trim()}&rdquo;</> : outer() ? <>nothing matches &ldquo;{(props.query ?? '').trim()}&rdquo;</> : 'nothing matches the active filters'}</StatusMessage></li></Show>
        <For each={visible()}>{item => <ListRow class="gap-x-4">
          <a {...artifactLink(`/a/${item.id}`, item.format ?? 'markup')} aria-label={`Open shared artifact ${item.id}`} class={`min-w-0 flex-1 truncate ${LINK}`}>{item.title || item.id}</a>
          <span class="w-28 truncate text-muted">{item.owner_username ? `@${item.owner_username}` : ''}</span>
          <span class="w-24 text-muted" aria-label={`Your role on ${item.id}`}>{SHARE_ROLE_LABEL[item.role]}</span>
          <FormatBadge format={item.format} />
          <span class="w-20 whitespace-nowrap text-right text-muted">{timeAgo(item.updated_at)}</span>
        </ListRow>}</For>
      </ul>
    </Panel>
  </section></Show>;
}
