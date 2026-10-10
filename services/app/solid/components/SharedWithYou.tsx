/* @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { WorkspaceSharedItem } from '@/lib/workspace/dashboard';
import { SHARE_ROLE_LABEL, SHARE_ROLES } from '@/lib/artifacts/share-roles';
import { FormatBadge, formatLabel, LINK, MicroLabel, PANEL, TABLE_ROW, timeAgo } from '../ui/ui';

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
  return <Show when={props.items.length}><section aria-label="Shared with you" class="mt-8"><div class="mb-2"><MicroLabel>shared with you</MicroLabel></div><div class={PANEL}><div class="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2"><input aria-label="Search shared artifacts" placeholder="search shared artifacts" value={query()} onInput={event => setQuery(event.currentTarget.value)} class="min-w-32 flex-1 border-0 bg-transparent font-mono text-xs text-fg placeholder:text-faint focus:outline-none" /><Show when={formats().length >= 2 || roles().length >= 2}><span class="flex shrink-0 flex-wrap items-center gap-1.5 border-edge sm:ml-auto sm:border-l sm:pl-2"><Show when={formats().length >= 2}><For each={formats()}>{format => <button type="button" aria-label={`Filter ${format}`} aria-pressed={formatPicks().includes(format)} onClick={() => toggle('format', format)} class="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px]">{formatLabel(format)}</button>}</For></Show><Show when={roles().length >= 2}><For each={roles()}>{role => <button type="button" aria-label={`Filter ${role}`} aria-pressed={rolePicks().includes(role)} onClick={() => toggle('role', role)} class="rounded-full border border-edge px-2 py-0.5 font-mono text-[10px]">{SHARE_ROLE_LABEL[role]}</button>}</For></Show></span></Show><Show when={filtering()}><span class="shrink-0 border-l border-edge pl-2 font-mono text-[10px] text-faint">{visible().length}/{props.items.length}</span></Show></div><div class="overflow-x-auto"><table class="w-full text-left font-mono text-xs"><tbody><Show when={visible().length === 0}><tr class={TABLE_ROW}><td colspan={5} class="px-4 py-6 text-center text-faint">{q() ? <>nothing matches &ldquo;{query().trim()}&rdquo;</> : outer() ? <>nothing matches &ldquo;{(props.query ?? '').trim()}&rdquo;</> : 'nothing matches the active filters'}</td></tr></Show><For each={visible()}>{item => <tr class={TABLE_ROW}><td class="px-3 py-2"><a href={`/a/${item.id}`} aria-label={`Open shared artifact ${item.id}`} class={LINK}>{item.title || item.id}</a></td><td class="px-3 py-2 text-muted">{item.owner_username ? `@${item.owner_username}` : ''}</td><td class="px-3 py-2 text-muted" aria-label={`Your role on ${item.id}`}>{SHARE_ROLE_LABEL[item.role]}</td><td class="px-3 py-2"><FormatBadge format={item.format} /></td><td class="px-3 py-2 text-right whitespace-nowrap text-muted">{timeAgo(item.updated_at)}</td></tr>}</For></tbody></table></div></div></section></Show>;
}
