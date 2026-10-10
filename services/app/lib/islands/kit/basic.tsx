/* @jsxImportSource solid-js */
import { Show, createEffect, createSignal, onCleanup, splitProps, type JSX } from 'solid-js';
import { isServer } from 'solid-js/web';
import { refName, resolveBindings, rowBound } from '@/lib/dataflow/dataflow';
import type { BindingSource, Row, Scalar } from '@/lib/dataflow';
import { VIEWER_ID } from '@/lib/dataflow/builtins';
import { refusalText } from '@artifactbin/contracts/sign-in-required';
import { MutationHint } from './disclosure';
import { useIsland } from '../context';
import type { IslandContext } from '../contract';
import type { RowScope } from '../rt';
import { substituteRow } from '@/lib/jsx/row-scope';
import { URL_ATTRS, URL_LIST_ATTRS, urlListUrls } from '@/lib/jsx/url-attrs';
import { commentMetadata, instanceDomId } from '@/lib/story-ui/repeat-identity';
import { iconGlyphKey, FALLBACK_ICON_KEY, type GlyphMap } from '@/lib/story-ui/icon-contract';

import { createRowActions } from '../row-actions';
import { ACCESS_PENDING, hydratedRead } from './store-read';

// Mirrors lib/jsx/validate hasDangerousScheme without importing the validator into the browser kit.
// eslint-disable-next-line no-control-regex -- browsers remove controls and spaces within URL schemes
const dangerous = (url: string) => /^(?:javascript:|vbscript:|data:(?!image\/))/i.test(url.replace(/[\x00-\x20]/g, ''));
const IDREF_ATTRS = 'for aria-labelledby aria-describedby aria-controls aria-owns headers list form'.split(' ');

/** Substitute and scope attributes only for the row components that use them. */
export function rowAttrs(attrs: Readonly<Record<string, unknown>>, row: Record<string, unknown> | null | undefined, scope?: RowScope | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(attrs)) {
    const lower = name.toLowerCase();
    const value = row && lower !== 'id' ? substituteRow(raw, row) : raw;
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'string' && (URL_LIST_ATTRS.has(lower) ? urlListUrls(value, lower).some(dangerous) : URL_ATTRS.has(lower) && dangerous(value))) continue;
    out[name] = value === true ? '' : String(value);
  }
  if (scope) {
    const key = ['repeat', scope.owner, scope.durable ? typeof scope.key : 'index', scope.key];
    if (!scope.durable) delete out['data-mx-ast'];
    if (typeof out.id === 'string') {
      if (scope.durable) Object.assign(out, commentMetadata(scope.owner, { kind: 'repeat', scopes: [{ nodeId: scope.owner, key: scope.key as string | number }], templateNodeId: out.id }));
      out.id = instanceDomId(key, out.id);
    }
    for (const attr of IDREF_ATTRS) {
      const v = out[attr];
      if (typeof v === 'string') out[attr] = v.split(/\s+/).map((id) => (scope.ids.includes(id) ? instanceDomId(key, id) : id)).join(' ');
    }
    if (typeof out.href === 'string' && out.href.startsWith('#') && scope.ids.includes(out.href.slice(1))) out.href = '#' + instanceDomId(key, out.href.slice(1));
  }
  return out;
}

/**
 * lib/story-ui/comment-target isCommentKey (the interpreter's validRowKey), restated: importing it from a kit
 * family re-partitions the shared runtime's chunks (the island build splits by file), +170 B on rt+boot.
 * kit-writes.test pins the two equal.
 */
// eslint-disable-next-line no-control-regex -- the same control-character rule as isCommentKey
export const stableRowKey = (value: unknown): boolean => (typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f]/.test(value)) || (typeof value === 'number' && Number.isFinite(value));
const viewerId = (island: IslandContext): string | null => { const v = island.viewer(); return v && 'id' in v ? v.id : null; };

type DivProps = JSX.HTMLAttributes<HTMLDivElement>;
type SpanProps = JSX.HTMLAttributes<HTMLSpanElement>;

export function Badge(props: SpanProps & { variant?: string }) { const { variant = 'default', ...rest } = props; return <span data-slot="badge" data-variant={variant} {...rest} />; }
export function Progress(props: DivProps & { value?: number | string }) {
  const [own, rest] = splitProps(props, ['value']);
  const valid = () => typeof own.value === 'number' && Number.isFinite(own.value) && own.value >= 0 && own.value <= 100;
  const state = () => valid() ? (own.value === 100 ? 'complete' : 'loading') : 'indeterminate';
  return <div data-slot="progress" role="progressbar" aria-valuenow={valid() ? own.value : undefined} aria-valuemin="0" aria-valuemax="100" data-state={state()} data-value={valid() ? own.value : undefined} data-max="100" {...rest}>
    <div data-slot="progress-indicator" data-state={state()} data-value={valid() ? own.value : undefined} data-max="100" class="h-full w-full flex-1 bg-primary transition-all" style={{ transform: `translateX(-${100 - (Number(own.value) || 0)}%)` }} />
  </div>;
}
const catalogs = new Map<string, Promise<GlyphMap>>();
function loadGlyphCatalog(url: string): Promise<GlyphMap> {
  let loading = catalogs.get(url);
  if (!loading) {
    loading = import(/* @vite-ignore */ url).then((module: { glyphs?: GlyphMap }) => module.glyphs ?? {});
    catalogs.set(url, loading);
    loading.catch(() => catalogs.delete(url));
  }
  return loading;
}
export function Icon(props: JSX.SvgSVGAttributes<SVGSVGElement> & { name: string; glyphs: GlyphMap; catalogUrl?: string }) {
  const [own, rest] = splitProps(props, ['name', 'glyphs', 'catalogUrl', 'class']);
  const [catalog, setCatalog] = createSignal<GlyphMap>({});
  createEffect(() => {
    const key = iconGlyphKey(String(own.name));
    if (!own.glyphs[key] && !catalog()[key] && own.catalogUrl) void loadGlyphCatalog(own.catalogUrl).then(setCatalog);
  });
  const glyph = () => own.glyphs[iconGlyphKey(String(own.name))] ?? catalog()[iconGlyphKey(String(own.name))] ?? own.glyphs[FALLBACK_ICON_KEY] ?? catalog()[FALLBACK_ICON_KEY];
  const accessible = Object.keys(rest).some((key) => key.startsWith('aria-') || key === 'role' || key === 'title');
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    class={['lucide', glyph()?.cls, own.class ?? 'inline-block size-4 shrink-0 align-[-0.125em]'].filter(Boolean).join(' ')}
    aria-hidden={accessible ? undefined : 'true'} data-slot="icon" {...rest} innerHTML={glyph()?.inner ?? ''} />;
}
export function Alert(props: DivProps & { variant?: string }) { const { variant: _variant, ...rest } = props; return <div data-slot="alert" role="alert" {...rest} />; }
export function AlertTitle(props: DivProps) { return <div data-slot="alert-title" {...props} />; }
export function AlertDescription(props: DivProps) { return <div data-slot="alert-description" {...props} />; }
export function Card(props: DivProps) { return <div data-slot="card" {...props} />; }
export function CardHeader(props: DivProps) { return <div data-slot="card-header" {...props} />; }
export function CardTitle(props: DivProps) { return <div data-slot="card-title" {...props} />; }
export function CardDescription(props: DivProps) { return <div data-slot="card-description" {...props} />; }
export function CardAction(props: DivProps) { return <div data-slot="card-action" {...props} />; }
export function CardContent(props: DivProps) { return <div data-slot="card-content" {...props} />; }
export function CardFooter(props: DivProps) { return <div data-slot="card-footer" {...props} />; }
type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; run?: unknown; set?: unknown; args?: unknown; row?: Row | null; rowScope?: RowScope | null };
type Bindings = Record<string, BindingSource>;
const bindings = (map: unknown, row: Row | null | undefined): Bindings | null => map && typeof map === 'object' ? (row ? rowBound(map as Bindings, row) : map as Bindings) : null;
const scalarRow = (row: Row): Record<string, Scalar> => Object.fromEntries(Object.entries(row).filter((entry): entry is [string, Scalar] => {
  const v = entry[1]; return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}));
const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'that did not save');

/**
 * Each document's row actions (the former RowActionsContext, lib/islands/row-actions): a row's write
 * in flight, and its refusal, belong to the document, so they outlive the button — a row reordered,
 * filtered or scrolled out of a virtual window and back is still busy, and a second click writes nothing.
 */
const rowActions = new WeakMap<IslandContext, ReturnType<typeof createRowActions>>();
const rowActionsOf = (island: IslandContext) => {
  let actions = rowActions.get(island);
  if (!actions) rowActions.set(island, actions = createRowActions());
  return actions;
};

/**
 * `<Button>`, and live: `run="$add" set={{…}} args={{…}}` (the former runtime's ButtonAdapter / RuntimeRowAction). A click first sets the page values `set=` names, in one step, then
 * performs the named `<Mutation>` with `args=`. While it is in flight the button is `aria-busy` and
 * disabled; a write the reader may not make (a guest's `$_me` write, a closed dataset, a check still in
 * flight) is disabled with the reason as its accessible description and in a tooltip; a refusal is shown in
 * a `role="alert"`. In a `<For>` row it writes with the row, as a row action does.
 */
export function Button(props: ButtonProps) {
  const [own, rest] = splitProps(props, ['variant', 'size', 'run', 'set', 'args', 'row', 'rowScope']);
  const variant = own.variant ?? 'default', size = own.size ?? 'default';
  const name = typeof own.run === 'string' ? refName(own.run) : null;
  if (!name && !own.set) return <button data-slot="button" data-variant={variant} data-size={size} {...rest} />;
  const island = useIsland();
  const store = island.store();
  if (!store) {
    // The former static face: the binding stamped, the button disabled.
    const stamp = [name ? `run:${own.run}` : '', own.set && typeof own.set === 'object' ? `set:${Object.keys(own.set).join(',')}` : ''].filter(Boolean).join(' ');
    return <button data-slot="button" data-variant={variant} data-size={size} data-mx-bound={stamp} disabled {...rest} />;
  }
  const row = own.row ?? null;
  const read = (map: unknown) => { const b = bindings(map, row); return b ? resolveBindings(b, (ref) => (ref === VIEWER_ID ? viewerId(island) : store.getValue(ref))) : undefined; };
  // The server render has no transport: the context says what the former served page says until the check answers.
  const unavailable = hydratedRead(() => (name ? island.mutationUnavailable(name) : null), { value: name ? ACCESS_PENDING : null });
  const [error, setError] = createSignal<string | null>(null);
  const alert = <Show when={error()}><span role="alert" class="mx-write-error">{error()}</span></Show>;
  // A row ACTION is a row's `run=` (the interpreter's rowAction); a `set=`-only button in a row just sets its row's values.
  if (row && name) {
    const scope = own.rowScope;
    if (!scope?.durable || !stableRowKey(scope.key)) return <span role="alert">Row actions require a stable row key</span>;
    // The interpreter's row action identity: the repeat, the row's key, the button's node, its mutation.
    const identity = JSON.stringify([scope.owner, typeof scope.key, scope.key, (rest as Record<string, unknown>)['data-mx-ast'] ?? '', own.run]);
    const actions = rowActionsOf(island);
    const [state, setState] = createSignal(actions.get(identity), { equals: false });
    if (!isServer) onCleanup(actions.subscribe(() => setState(actions.get(identity))));
    const pending = () => !!state()?.pending;
    const click = () => {
      if (!name || unavailable() !== null || pending() || rest.disabled === true) return;
      const snapshot = scalarRow(row);
      const values = read(own.set);
      if (values) store.setValues(values);
      void actions.run(identity, () => store.mutate(name, read(own.args) ?? {}, snapshot));
    };
    return <><MutationHint reason={refusalText(unavailable())}><button data-slot="button" data-variant={variant} data-size={size} {...rest} type="button" disabled={unavailable() !== null || pending() || rest.disabled === true}
      aria-busy={pending() || undefined} aria-description={refusalText(unavailable()) ?? undefined} on:click={click} /></MutationHint><Show when={state()?.error}><span role="alert" class="mx-write-error">{state()?.error}</span></Show></>;
  }
  const busy = () => !!name && island.mutating(name);
  const click = () => {
    if (unavailable() !== null || busy() || rest.disabled === true) return;
    setError(null);
    const values = read(own.set);
    if (values) store.setValues(values);
    if (name) store.mutate(name, read(own.args)).catch((e: unknown) => setError(messageOf(e)));
  };
  return <><MutationHint reason={refusalText(unavailable())}><button data-slot="button" data-variant={variant} data-size={size} {...rest} aria-busy={busy() || undefined} disabled={busy() || unavailable() !== null || rest.disabled === true}
    aria-description={refusalText(unavailable()) ?? undefined} on:click={click} /></MutationHint>{alert}</>;
}
