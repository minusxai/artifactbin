/* @jsxImportSource solid-js */
/**
 * EDITING CELLS (`@mx/kit/cells`, a family of its own: only a page whose table has column content loads it): a `<Column>`'s content in each row of a
 * `<DataTable>`, and in it the former editing cell — a
 * `<Select>`, a `<DatePicker>` or a native `<input>`/`<textarea>`/`<select>` with `run="$mutation"`.
 *
 * - `cellAttrs` is the interpreter's table scope (story-ui/interpreter scopeProps with a tableCommentScope) over
 *   rt's row attributes: an author id becomes the row's instance id (`['table', owner, typeof key, key, column]`),
 *   the idrefs naming the column's ids follow it, and a durable row carries its comment target.
 * - `CellControl` keeps a draft per cell in ONE document-local session store (lib/story-runtime/cell-sessions),
 *   so a draft survives the row re-rendering (a refresh, a sort, the virtual window moving). Committing writes
 *   the declared `<Mutation>` with the row and the draft as `$_value`; the cell is `aria-busy` and disabled while
 *   the write is in flight, and the server's refusal is shown beside it (`role="alert"`) with the draft kept. A
 *   reader who may not write sees the cell disabled with the reason as its description (the store's write check,
 *   followed live, so a permission change reaches a cell already on screen).
 *
 * The DOM matches the former React render, element for element (pinned by lib/islands/__tests__/kit-parity): the compiler
 * serialises each control's authored attributes with React's attribute rules (static-solid/attrs) and evaluates its class with the kit's merger at compile time (`attrs`, `cls`); only
 * the row's values, the scope and the state are applied here.
 */
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack, type JSX } from 'solid-js';
import { isServer } from 'solid-js/web';
import { controlOptions as optionsOf, type ControlOption as Option, refName, resolveBindings, rowBound, type BindingSource, type Row, type Scalar } from '@/lib/story/data/dataflow';
import { substituteRow } from '@/lib/story/data/row-scope';
import { VIEWER_ID } from '@/lib/story/data/builtins';
import { refusalText } from '@/lib/story/reader/sign-in-required';
import { commentMetadata, instanceDomId } from '@/lib/story/data/repeat-identity';
import { createCellSessions, type CellSessions } from '@/lib/story-runtime/cell-sessions';
import { rowAttrs } from './basic';
import { useIsland } from '../context';
import type { IslandContext } from '../contract';
import { ACCESS_PENDING, hydratedRead } from './store-read';
import { MutationHint } from './disclosure';
import { popupDismiss } from './popup-dismiss';

/** Where one cell sits: what the DataTable hands each column's content, per row. */
export interface CellScope {
  /** The table's author id: the comment owner and the instance ids' scope. Empty: the table has none, and nothing is scoped. */
  owner: string;
  /** The table's identity for cell drafts (its node path). */
  table: string;
  /** The table's data name (`data="$name"`): the value field's column type is read from it. */
  data: string;
  /** The row's `rowKey` value, as read (a row action checks it is stable). */
  key: unknown;
  durable: true;
  /** The row's position: the scope of a row without a stable key. */
  index: number;
  column: string;
  /** The column content's author ids: an idref naming one follows it to the row's instance. */
  ids: readonly string[];
}

/** lib/story/annotations/comment-target isCommentKey (the interpreter's validRowKey), restated as kit/basic does. */
// eslint-disable-next-line no-control-regex -- the same control-character rule as isCommentKey
const stableKey = (value: unknown): value is string | number => (typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f]/.test(value)) || (typeof value === 'number' && Number.isFinite(value));
const IDREFS = ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto', 'headers', 'list', 'form'];

/** An element's attributes inside a cell, resolved for its row (interpreter rawBuildProps with the row + scopeProps). */
export function cellAttrs(attrs: Readonly<Record<string, unknown>>, row: Row | null | undefined, cell?: CellScope | null): Record<string, string> {
  const out = rowAttrs(attrs, row, null);
  if (!cell?.owner) return out;
  const key = stableKey(cell.key) ? cell.key : undefined;
  const scope = ['table', cell.owner, typeof key, key ?? ['index', cell.index], cell.column];
  const own = (id: string) => cell.ids.includes(id);
  if (out.id) {
    if (key !== undefined) Object.assign(out, commentMetadata(cell.owner, { kind: 'table', rowKey: key, columnKey: cell.column, templateNodeId: out.id }));
    out.id = instanceDomId(scope, out.id);
  }
  for (const name of IDREFS) { const v = out[name]; if (v !== undefined) out[name] = v.split(/\s+/).map((id) => (own(id) ? instanceDomId(scope, id) : id)).join(' '); }
  for (const [name, v] of Object.entries(out)) {
    if (name === 'href' && v.startsWith('#') && own(v.slice(1))) out[name] = `#${instanceDomId(scope, v.slice(1))}`;
    else if (/^url\(#[^)]+\)$/.test(v) && own(v.slice(5, -1))) out[name] = `url(#${instanceDomId(scope, v.slice(5, -1))})`;
  }
  return out;
}

/** One draft store per document: cells unmount and remount, their drafts stay. */
const documents = new WeakMap<IslandContext, CellSessions>();
const sessionsOf = (island: IslandContext): CellSessions => {
  let sessions = documents.get(island);
  if (!sessions) documents.set(island, (sessions = createCellSessions()));
  return sessions;
};

const scalarRow = (row: Row): Record<string, Scalar> => Object.fromEntries(Object.entries(row).filter((entry): entry is [string, Scalar] => {
  const v = entry[1]; return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}));
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const join = (...v: (string | false | null | undefined)[]) => v.filter(Boolean).join(' ');

const parseMulti = (raw: string | null | undefined): string[] | null => {
  if (!raw) return [];
  try { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed) && parsed.every((i): i is string => typeof i === 'string')) return [...new Set(parsed)]; } catch { /* a bad persisted value is never an empty write */ }
  return null;
};

/* ────────────────────────────────────────────────────────────────────────────
 * The popup, as the former cell controls place it
 * ──────────────────────────────────────────────────────────────────────────── */

const POPUP_TOKENS = ['--background', '--foreground', '--popover', '--popover-foreground', '--primary', '--primary-foreground', '--muted', '--muted-foreground', '--accent', '--accent-foreground', '--border', '--input', '--ring', '--radius', '--font-body', '--font-mono'];
/** Out of the table's scroll box: the nearest `<dialog>`, else the body. */
const popupHost = (root: HTMLElement): HTMLElement => root.closest('dialog') ?? root.ownerDocument.body;
/** The anchor's colour scope (`data-theme`, `dark`/`light`), which a portaled popup must carry. */
function popupTheme(root: HTMLElement): { dataTheme?: string; className?: string } {
  const themed = root.closest('[data-theme], .dark, .light') as HTMLElement | null;
  return { dataTheme: themed?.dataset.theme, className: join(themed?.classList.contains('dark') && 'dark', themed?.classList.contains('light') && 'light') || undefined };
}
/** Fixed beside its anchor, flipped above when there is more room there, following scroll and resize, with the anchor's tokens. */
function anchor(root: HTMLElement, popup: HTMLElement, width?: number): () => void {
  const win = root.ownerDocument.defaultView!;
  const place = () => {
    const style = win.getComputedStyle(root);
    for (const token of POPUP_TOKENS) { const value = style.getPropertyValue(token); if (value) popup.style.setProperty(token, value); else popup.style.removeProperty(token); }
    Object.assign(popup.style, { fontFamily: style.fontFamily, colorScheme: style.colorScheme, direction: style.direction });
    const rect = root.getBoundingClientRect();
    const w = Math.min(width ?? Math.max(rect.width, 200), win.innerWidth - 16);
    const height = popup.getBoundingClientRect().height;
    const below = win.innerHeight - rect.bottom - 12;
    const top = below >= height || below >= rect.top - 12 ? rect.bottom + 4 : rect.top - height - 4;
    Object.assign(popup.style, { position: 'fixed', zIndex: '50', width: `${w}px`, left: `${Math.max(8, Math.min(rect.left, win.innerWidth - w - 8))}px`, top: `${Math.max(8, Math.min(top, win.innerHeight - height - 8))}px`, maxHeight: `${win.innerHeight - 16}px`, overflowY: 'auto' });
  };
  place();
  win.addEventListener('resize', place);
  root.ownerDocument.addEventListener('scroll', place, true);
  return () => { win.removeEventListener('resize', place); root.ownerDocument.removeEventListener('scroll', place, true); };
}
/** Mount `view` in the popup host while `open()`, directly (no wrapper); removed on close. */
function usePopup(open: () => boolean, root: () => HTMLElement | undefined, view: () => HTMLElement, width?: number): void {
  createEffect(() => {
    const anchorEl = root();
    if (!open() || !anchorEl) return;
    // Building the popup may read changing rows/options; those updates belong to its children,
    // not to this mount effect, or a live refresh removes the anchor mid-interaction.
    const popup = untrack(view);
    popupHost(anchorEl).append(popup);
    const stop = anchor(anchorEl, popup, width);
    onCleanup(() => { stop(); popup.remove(); });
  });
}
/** A cell popup joins the kit's one popup contract (outside press, Escape, one open at a time). */
const cellPopup = (open: () => boolean, root: () => HTMLElement | undefined, popup: () => HTMLElement | undefined, away: () => void) => {
  const announce = popupDismiss(open, away, root, popup);
  createEffect(on(open, (isOpen) => { if (isOpen) announce(); }));
};

const CHEVRON = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4 shrink-0 opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const CHECK = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>;
const CALENDAR = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0 opacity-50" aria-hidden="true"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>;
const ARROW = (d: string) => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><path d={d} /></svg>;
/** The cell appearance of the former SelectControl / DateControl triggers. */
const SELECT_TRIGGER = 'inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-8 min-w-0 border border-transparent bg-transparent px-2 hover:border-border hover:bg-muted/60';
const DATE_TRIGGER = 'inline-flex items-center justify-between rounded-md text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-8 w-full min-w-0 gap-1 border border-transparent bg-transparent px-1 hover:border-border hover:bg-muted/60';
const POPUP = 'rounded-md border border-border bg-popover text-popover-foreground shadow-md';

/* ────────────────────────────────────────────────────────────────────────────
 * The cell
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CellControlProps {
  /** `Select`, `DatePicker`, or a native `input` / `textarea` / `select`. */
  tag: string;
  /** The `<Mutation>` its `run` names. */
  run: string;
  /** The row field its `value` reads (`$_row.<field>`), whose column type shapes a chosen value. */
  field?: string;
  /** The authored props the control reads (value, label, options, …), `$_row` references unresolved. */
  p: Readonly<Record<string, unknown>>;
  /** The control's element (native) or shell (Select/DatePicker) attributes, as React serialises them. */
  attrs: Readonly<Record<string, unknown>>;
  /** That element's class, merged at compile time. */
  cls: string;
  /** The control's node path: its draft's identity within the cell. */
  path: string;
  row: Row;
  cell: CellScope;
  children?: JSX.Element;
}

export function CellControl(props: CellControlProps) {
  const island = useIsland();
  const store = island.store();
  const sessions = sessionsOf(island);
  const { row, cell } = props;
  // The row is the bridged store's row: a re-run that changes its values updates it in place, and what reads it follows.
  const authored = createMemo(() => Object.fromEntries(Object.entries(props.p).map(([k, v]) => [k, (k === 'args' || k === 'set') && v && typeof v === 'object' ? rowBound(v as Record<string, BindingSource>, row) : substituteRow(v, row)])));
  const identity = JSON.stringify([cell.table, typeof cell.key, cell.key, cell.column, props.path]);
  const initial = () => (authored().value ?? null) as Scalar;
  const unavailable = hydratedRead(() => island.mutationUnavailable(props.run), { value: ACCESS_PENDING });
  const [version, setVersion] = createSignal(0);
  if (!isServer) onCleanup(sessions.subscribe(() => setVersion((n) => n + 1)));
  const session = () => { version(); return sessions.get(identity); };
  // A saved draft is dropped once the authoritative rows carry it.
  createEffect(() => { void session()?.phase; sessions.reconcile(identity, initial()); });
  const writable = () => unavailable() === null;
  const value = () => { const s = session(); return s ? s.draft : initial(); };
  const busy = () => session()?.phase === 'pending' || session()?.phase === 'saved';
  const disabled = () => !writable() || busy() || authored().disabled === true;
  const reason = () => refusalText(unavailable());
  const begin = () => sessions.begin(identity, initial(), scalarRow(row));
  const cancel = () => sessions.cancel(identity);
  const change = (next: Scalar) => { begin(); sessions.change(identity, next); };
  const viewerId = () => { const v = island.viewer(); return v && 'id' in v ? v.id : null; };
  const commit = () => {
    if (!writable() || !store) return;
    const bound = authored().args;
    const args = bound && typeof bound === 'object' ? resolveBindings(bound as Record<string, BindingSource>, (ref) => (ref === VIEWER_ID ? viewerId() : store.getValue(ref))) : {};
    void sessions.commit(identity, (draft, _original, snapshot) => store.mutate(props.run, { ...args, _value: draft }, { ...snapshot }));
  };
  const label = () => str(authored()['aria-label']) ?? str(authored().label) ?? `${cell.column} ${String(cell.key)}`;
  const valueType = () => island.tableSnapshot(cell.data)?.columns.find((c) => c.name === props.field)?.type;
  const typed = (next: string | null): Scalar => (next === null ? null : valueType() === 'number' ? (next === '' ? null : Number(next)) : valueType() === 'boolean' ? next === 'true' : next);
  const attrs = () => cellAttrs(props.attrs, row, cell);
  const control = (): JSX.Element => {
    if (props.tag === 'Select') return <CellSelect {...{ authored, label, value, session, disabled, busy, unavailable, change, commit, cancel, begin, typed, valueType, attrs, cls: props.cls, cell, field: props.field }}>{props.children}</CellSelect>;
    if (props.tag === 'DatePicker') return <CellDate {...{ authored, label, value, disabled, busy, unavailable, change, commit, valueType, attrs, cls: props.cls }} />;
    return <CellNative {...{ tag: props.tag, authored, label, value, disabled, reason, begin, change, commit, cancel, typed, attrs, cls: props.cls, sessions, identity }}>{props.children}</CellNative>;
  };
  // The disabled control cannot take focus: its stable wrapper carries the reason,
  // and holds the refusal of a write beside the control.
  return <MutationHint reason={reason()} fullWidth>{control()}
    <Show when={session()?.error}>{(error) => <span role="alert" class="mx-write-error">{error()}</span>}</Show>
  </MutationHint>;
}

interface Shared {
  authored: () => Record<string, unknown>;
  label: () => string;
  value: () => Scalar;
  disabled: () => boolean;
  attrs: () => Record<string, string>;
  cls: string;
}

/** The former SelectControl, `appearance="cell"`, over a cell session. */
function CellSelect(props: Shared & {
  session: () => { draft: Scalar } | undefined; busy: () => boolean; unavailable: () => string | null; change(v: Scalar): void; commit(): void; cancel(): void; begin(): void;
  typed(v: string | null): Scalar; valueType: () => string | undefined; cell: CellScope; field?: string; children?: JSX.Element;
}) {
  const island = useIsland();
  const store = island.store();
  const a = () => props.authored();
  const multiple = () => props.valueType() !== 'user' && a().multiple === true;
  const allowCreate = () => props.valueType() !== 'user' && a().allowCreate === true;
  const placeholder = () => str(a().placeholder) ?? 'None';
  // A person column's choices (the store's userOptions): no island accessor, so the store is followed directly.
  const [userOptions, setUserOptions] = createSignal(store?.getState().userOptions);
  if (store && !isServer) onCleanup(store.subscribe(() => setUserOptions(() => store.getState().userOptions)));
  const options = createMemo((): Option[] => {
    const isUser = props.valueType() === 'user';
    let out: Option[];
    const raw = a().options;
    if (raw === undefined && isUser) out = userOptions()?.[`${props.cell.data}.${props.field}`] ?? [];
    else {
      const name = refName(raw);
      const table = name ? island.table(name) : undefined;
      out = optionsOf(raw, table);
      if (isUser && (!table || table.columns.length === 1)) out = out.map((o) => ({ ...o, label: o.label === o.value ? island.people()[o.value]?.name ?? o.label : o.label }));
    }
    const exclude = a().exclude;
    return exclude === undefined ? out : out.filter((o) => o.value !== String(exclude));
  });
  const value = () => { const v = props.value(); return v === null ? null : String(v); };
  const draftValue = () => { const s = props.session(); return s ? (s.draft === null ? null : String(s.draft)) : undefined; };
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(-1);
  const [internal, setInternal] = createSignal<string[]>(parseMulti(untrack(value)) ?? []);
  const draft = () => (draftValue() === undefined ? internal() : parseMulti(draftValue()) ?? []);
  const invalid = () => multiple() && (parseMulti(value()) === null || (draftValue() !== undefined && parseMulti(draftValue()) === null));
  const inert = () => props.disabled() || invalid();
  let opened = false;
  let root: HTMLDivElement | undefined;
  let popup: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;
  const entries = () => [
    ...(!multiple() && a().nullable === true ? [{ value: null as string | null, label: placeholder() }] : []),
    ...options(),
    ...(multiple() ? draft().filter((d) => !options().some((o) => o.value === d)).map((d) => ({ value: d as string | null, label: d })) : []),
  ];
  const filtered = () => { const q = query().trim().toLocaleLowerCase(); return q ? entries().filter((e) => e.label.toLocaleLowerCase().includes(q) || (e.value !== null && e.value.toLocaleLowerCase().includes(q))) : entries(); };
  const canCreate = () => multiple() && allowCreate() && !!query().trim() && !entries().some((e) => e.value === query().trim());
  const current = () => {
    if (multiple()) { const picked = parseMulti(value()) ?? []; return picked.length ? picked.map((i) => options().find((o) => o.value === i)?.label ?? i).join(', ') : placeholder(); }
    const v = value();
    return v === null ? placeholder() : options().find((o) => o.value === v)?.label ?? v;
  };
  const setOpened = (next: boolean) => { opened = next; setOpen(next); if (next) props.begin(); };
  const finish = (focus = true) => { setOpened(false); setQuery(''); setActive(-1); if (focus) root?.querySelector('button')?.focus(); };
  const updateDraft = (next: string[]) => { const unique = [...new Set(next)]; if (draftValue() === undefined) setInternal(unique); props.change(JSON.stringify(unique)); };
  const commitDraft = (focus = true) => {
    if (inert() || !opened) return;
    opened = false;
    const encoded = JSON.stringify(draft());
    props.change(props.typed(encoded));
    props.commit();
    finish(focus);
  };
  const cancelDraft = () => { if (!opened) return; opened = false; props.cancel(); finish(); };
  // A data refresh briefly makes the write check pending. Keep an already-open menu in place;
  // choosing remains blocked by inert() until the check answers.
  createEffect(() => { if ((invalid() || a().disabled === true || (props.unavailable() !== null && props.unavailable() !== ACCESS_PENDING)) && opened) setOpened(false); });
  const openList = () => { if (inert() || open()) return; if (multiple() && draftValue() === undefined) setInternal(parseMulti(value()) ?? []); setOpened(true); setQuery(''); setActive(-1); };
  const choose = (v: string | null) => {
    if (inert()) return;
    if (multiple() && v !== null) { updateDraft(draft().includes(v) ? draft().filter((i) => i !== v) : [...draft(), v]); setQuery(''); setActive(-1); search?.focus(); return; }
    props.change(props.typed(v));
    props.commit();
    opened = false;
    finish();
  };
  const create = (made: string) => { if (!draft().includes(made)) updateDraft([...draft(), made]); setQuery(''); setActive(-1); };
  const move = (step: 1 | -1) => setActive((i) => Math.max(0, Math.min(filtered().length + (canCreate() ? 1 : 0) - 1, i + step)));
  const matches = (q: string) => entries().some((e) => e.label.toLocaleLowerCase().includes(q) || (e.value !== null && e.value.toLocaleLowerCase().includes(q)));
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDraft(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && active() >= 0 && filtered()[active()]) { e.preventDefault(); choose(filtered()[active()]!.value); }
    else if (e.key === 'Enter' && multiple() && allowCreate() && query().trim()) { e.preventDefault(); create(query().trim()); }
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDraft(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); setActive(e.key === 'ArrowDown' ? 0 : Math.max(0, entries().length - 1)); return; }
    if (inert()) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (multiple() && draftValue() === undefined) setInternal(parseMulti(value()) ?? []);
      setOpened(true); setQuery(e.key); setActive(matches(e.key.toLocaleLowerCase()) ? 0 : -1);
    }
  };
  cellPopup(() => open(), () => root, () => popup, () => (multiple() ? commitDraft(false) : finish(false)));
  usePopup(() => open(), () => root, () => {
    const theme = popupTheme(root!);
    const node = <div ref={popup} {...{ 'data-theme': theme.dataTheme }} class={join(theme.className, POPUP)}
      on:focusout={(e) => { if (!opened) return; const next = e.relatedTarget as Node | null; if (next && (popup?.contains(next) || root?.contains(next))) return; if (multiple()) commitDraft(false); else finish(false); }}
      on:keydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDraft(); } }}>
      <div class="border-b border-border p-1.5"><input ref={(el) => { search = el; createEffect(() => el.setAttribute('value', query())); }} type="text" role="searchbox" aria-label={props.label() ? `Search ${props.label()}` : 'Search options'} placeholder="Type to filter…" value={query()}
        on:input={(e) => { const next = e.currentTarget.value; setQuery(next); setActive(matches(next.trim().toLocaleLowerCase()) ? 0 : -1); }} on:keydown={onSearchKey}
        class="h-8 w-full min-w-36 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" /></div>
      {/* Mouse down keeps focus in the search box (WebKit does not focus a pressed button). */}
      <div role="listbox" {...{ 'aria-multiselectable': multiple() ? 'true' : undefined }} aria-label={props.label()} class="max-h-56 overflow-y-auto p-1" on:mousedown={(e) => e.preventDefault()}>
        <For each={filtered()}>{(entry, i) => {
          const selected = () => (multiple() ? entry.value !== null && draft().includes(entry.value) : entry.value === value());
          return <button type="button" role="option" aria-selected={selected() ? 'true' : 'false'} aria-label={entry.label} on:click={() => choose(entry.value)} on:mouseenter={() => setActive(i())}
            class={join('flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm', i() === active() && 'bg-accent text-accent-foreground', entry.value === null && !selected() && 'text-muted-foreground')}>
            <span class="truncate">{entry.label}</span><Show when={selected()}><CHECK /></Show></button>;
        }}</For>
        <Show when={canCreate()} fallback={<Show when={filtered().length === 0}><div role="status" class="px-2 py-3 text-center text-sm text-muted-foreground">No matches</div></Show>}>
          <button type="button" role="option" aria-label={`Create ${query().trim()}`} aria-selected="false" on:click={() => create(query().trim())} on:mouseenter={() => setActive(filtered().length)}
            class={join('flex w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm', active() === filtered().length && 'bg-accent text-accent-foreground')}>Create “{query().trim()}”</button>
        </Show>
      </div>
      <div class="border-t border-border p-1.5" on:click={cancelDraft}>{props.children}</div>
      <Show when={multiple()}><div class="flex justify-end border-t border-border p-1.5"><button type="button" aria-label="Done" on:mousedown={(e) => e.preventDefault()} on:click={() => commitDraft()} class="rounded-sm px-2 py-1 text-sm font-medium hover:bg-accent">Done</button></div></Show>
    </div> as HTMLDivElement;
    queueMicrotask(() => search?.focus({ preventScroll: true }));
    return node;
  });
  return <div {...props.attrs()} class={props.cls} {...{ 'aria-busy': props.busy() ? 'true' : undefined, 'aria-description': props.unavailable() ?? undefined }}>
    <div ref={root} class="relative min-w-0">
      <button type="button" aria-label={props.label()} aria-haspopup="listbox" aria-expanded={open() ? 'true' : 'false'} disabled={inert()}
        on:click={() => { if (open()) { if (multiple()) commitDraft(); else finish(); } else openList(); }} on:keydown={onTriggerKey} class={SELECT_TRIGGER}>
        <span class={join('truncate', value() === null && 'text-muted-foreground')}>{current()}</span><CHEVRON /></button>
      <Show when={invalid()}><span role="alert">Expected a JSON array of strings.</span></Show>
    </div>
  </div>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function monthGrid(y: number, m: number) {
  const start = -new Date(y, m - 1, 1).getDay();
  const count = Math.ceil((-start + new Date(y, m, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => { const d = new Date(y, m - 1, 1 + start + i); return { iso: isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()), day: d.getDate(), inMonth: d.getMonth() === m - 1 }; });
}

/** The former DateControl, `appearance="cell"`: a pick is the whole edit, staged and committed in one gesture. */
function CellDate(props: Shared & { busy: () => boolean; unavailable: () => string | null; change(v: Scalar): void; commit(): void; valueType: () => string | undefined }) {
  const a = () => props.authored();
  const min = () => str(a().min), max = () => str(a().max);
  const shown = () => { const v = props.value(); return typeof v === 'string' ? (props.valueType() === 'timestamp' ? v.slice(0, 10) : v) : null; };
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal<{ y: number; m: number } | null>(null);
  let root: HTMLDivElement | undefined;
  let popup: HTMLDivElement | undefined;
  const today = new Date();
  const todayISO = isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const month = () => { const v = view(); if (v) return v; const m = /^(\d{4})-(\d{2})/.exec(shown() ?? ''); return m ? { y: Number(m[1]), m: Number(m[2]) } : { y: today.getFullYear(), m: today.getMonth() + 1 }; };
  const outOfRange = (iso: string) => { const lo = min(), hi = max(); return (lo !== undefined && iso < lo) || (hi !== undefined && iso > hi); };
  const step = (delta: number) => { const next = month().m + delta; setView({ y: month().y + Math.floor((next - 1) / 12), m: ((next - 1 + 12) % 12) + 1 }); };
  const choose = (iso: string | null) => { props.change(iso); props.commit(); setOpen(false); };
  cellPopup(() => open(), () => root, () => popup, () => setOpen(false));
  usePopup(() => open() && !props.disabled(), () => root, () => {
    const theme = popupTheme(root!);
    return <div ref={popup} role="dialog" aria-label={props.label() ? `${props.label()} calendar` : 'calendar'} {...{ 'data-theme': theme.dataTheme }} class={join(theme.className, POPUP.replace('bg-popover', 'bg-popover p-3'))}
      on:keydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
      <div class="flex items-center justify-between"><span class="px-1 text-sm font-medium">{MONTHS[month().m - 1]} {month().y}</span><span class="flex items-center gap-1">
        <button type="button" aria-label="Previous month" on:click={() => step(-1)} class="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">{ARROW('m15 18-6-6 6-6')}</button>
        <button type="button" aria-label="Next month" on:click={() => step(1)} class="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">{ARROW('m9 18 6-6-6-6')}</button>
      </span></div>
      <div class="mt-2 grid grid-cols-7 gap-y-0.5"><For each={DOW}>{(d) => <span aria-hidden="true" class="flex size-8 items-center justify-center text-[11px] font-medium uppercase text-muted-foreground">{d}</span>}</For>
        <For each={monthGrid(month().y, month().m)}>{(c) => {
          const selected = () => shown() === c.iso;
          return <button type="button" aria-label={c.iso} aria-pressed={selected() ? 'true' : 'false'} disabled={outOfRange(c.iso)} on:click={() => choose(c.iso)}
            class={join('flex size-8 items-center justify-center rounded-sm text-sm tabular-nums transition-colors', selected() ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground', !c.inMonth && !selected() && 'text-muted-foreground/50', !selected() && c.iso === todayISO && 'font-semibold text-primary', outOfRange(c.iso) && 'cursor-not-allowed opacity-30 hover:bg-transparent')}>{c.day}</button>;
        }}</For></div>
      <Show when={a().nullable === true || !outOfRange(todayISO)}><div class="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
        <Show when={a().nullable === true} fallback={<span />}><button type="button" on:click={() => choose(null)} class="rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">Clear</button></Show>
        <Show when={!outOfRange(todayISO)}><button type="button" on:click={() => choose(todayISO)} class="rounded-sm px-1.5 py-0.5 text-primary transition-colors hover:bg-accent">Today</button></Show>
      </div></Show>
    </div> as HTMLDivElement;
  }, 256);
  return <div {...props.attrs()} class={props.cls} {...{ 'aria-busy': props.busy() ? 'true' : undefined, 'aria-description': props.unavailable() ?? undefined }}>
    <div ref={root} class="relative w-full min-w-0">
      <button type="button" aria-label={props.label()} aria-haspopup="dialog" aria-expanded={open() ? 'true' : 'false'} disabled={props.disabled()}
        on:click={() => { setView(null); setOpen(!open()); }} on:keydown={(e) => { if (e.key === 'Escape') setOpen(false); }} class={DATE_TRIGGER}>
        <span class={join('truncate', shown() === null && 'text-muted-foreground')}>{shown() ?? 'Pick a date'}</span><CALENDAR /></button>
    </div>
  </div>;
}

/** The former native editing cell: the authored element, its draft committed on Enter, change (a select) or blur. */
function CellNative(props: Shared & {
  tag: string; reason: () => string | null; begin(): void; change(v: Scalar): void; commit(): void; cancel(): void; typed(v: string | null): Scalar;
  sessions: CellSessions; identity: string; children?: JSX.Element;
}) {
  const text = () => { const v = props.value(); return v === null ? '' : String(v); };
  const commitDraft = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    if (!el.validity.valid) { el.reportValidity(); return; }
    const active = props.sessions.get(props.identity);
    if (!active || (active.phase !== 'editing' && active.phase !== 'error')) return;
    if (props.authored().type === 'number') {
      const n = active.draft === '' || active.draft === null ? null : Number(active.draft);
      if (n !== null && !Number.isFinite(n)) return;
      props.sessions.change(props.identity, n);
    }
    props.commit();
  };
  const onInput = (e: Event) => { const el = e.currentTarget as HTMLInputElement; props.change(props.tag === 'select' ? props.typed(el.value) : el.value); };
  // Virtualization can blur a focused cell while removing its row. Commit only if the
  // element survives that render; a draft for an unmounted row stays in CellSessions.
  const onBlur = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    // An invalid input may have just yielded focus to another cell. A delayed
    // reportValidity would steal that focus back and close the new cell's popup.
    if (!el.validity.valid) return;
    setTimeout(() => { if (el.isConnected) commitDraft(el); }, 0);
  };
  const onKey = (e: KeyboardEvent) => {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'Escape') { e.preventDefault(); props.cancel(); el.blur(); }
    else if (e.key === 'Enter' && !(props.tag === 'textarea' && e.shiftKey)) { e.preventDefault(); commitDraft(el); }
  };
  const common = () => ({ ...props.attrs(), 'aria-label': props.label(), 'aria-description': props.reason() ?? undefined, class: props.cls });
  // React keeps a controlled field's value ATTRIBUTE in step with its value; the property follows the draft.
  const bind = (el: HTMLInputElement | HTMLSelectElement) => createEffect(() => { const v = text(); if (el.value !== v) el.value = v; if (el instanceof HTMLInputElement) el.setAttribute('value', v); });
  if (props.tag === 'select') {
    return <select {...common()} disabled={props.disabled()} ref={(el) => queueMicrotask(() => bind(el))} on:focus={props.begin}
      on:change={(e) => { onInput(e); commitDraft(e.currentTarget); }} on:blur={(e) => onBlur(e.currentTarget)} on:keydown={onKey}>{props.children}</select>;
  }
  if (props.tag === 'textarea') {
    // A textarea's served value is its content (React), the live value its property.
    return <textarea {...common()} disabled={props.disabled()} {...({ 'prop:value': text() } as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      on:focus={props.begin} on:input={onInput} on:blur={(e) => onBlur(e.currentTarget)} on:keydown={onKey}>{untrack(text)}</textarea>;
  }
  return <input {...common()} value={text()} disabled={props.disabled()} ref={bind} on:focus={props.begin} on:input={onInput} on:blur={(e) => onBlur(e.currentTarget)} on:keydown={onKey} />;
}
