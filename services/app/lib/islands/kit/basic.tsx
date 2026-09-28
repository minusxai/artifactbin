/* @jsxImportSource solid-js */
import { Show, createSignal, splitProps, type JSX } from 'solid-js';
import { isServer } from 'solid-js/web';
import { refName, resolveBindings, rowBound, type BindingSource, type Row, type Scalar } from '@/lib/story/dataflow';
import { VIEWER_ID } from '@/lib/story/builtins';
import { refusalText } from '@/lib/story/sign-in-required';
import { useIsland } from '../context';
import type { IslandContext } from '../contract';
import type { RowScope } from '../rt';
import { ACCESS_PENDING, storeRead } from './store-read';

/**
 * lib/story/comment-target isCommentKey (the interpreter's validRowKey), restated: importing it from a kit
 * family re-partitions the shared runtime's chunks (the island build splits by file), +170 B on rt+boot.
 * kit-writes.test pins the two equal.
 */
// eslint-disable-next-line no-control-regex -- the same control-character rule as isCommentKey
export const stableRowKey = (value: unknown): boolean => (typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f]/.test(value)) || (typeof value === 'number' && Number.isFinite(value));
const viewerId = (island: IslandContext): string | null => { const v = island.viewer(); return v && 'id' in v ? v.id : null; };

type DivProps = JSX.HTMLAttributes<HTMLDivElement>;
type SpanProps = JSX.HTMLAttributes<HTMLSpanElement>;

export function Badge(props: SpanProps & { variant?: string }) { const { variant = 'default', ...rest } = props; return <span data-slot="badge" data-variant={variant} {...rest} />; }
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
 * `<Button>`, and live: `run="$add" set={{…}} args={{…}}` (today's ButtonAdapter / RuntimeRowAction in
 * lib/story-runtime/StoryRuntimeApp). A click first sets the page values `set=` names, in one step, then
 * performs the named `<Mutation>` with `args=`. While it is in flight the button is `aria-busy` and
 * disabled; a write the reader may not make (a guest's `$_me` write, a closed dataset, a check still in
 * flight) is disabled with the reason as its accessible description and beside it; a refusal is shown in
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
    // Today's static face (components/kit/button): the binding stamped, the button disabled.
    const stamp = [name ? `run:${own.run}` : '', own.set && typeof own.set === 'object' ? `set:${Object.keys(own.set).join(',')}` : ''].filter(Boolean).join(' ');
    return <button data-slot="button" data-variant={variant} data-size={size} data-mx-bound={stamp} disabled {...rest} />;
  }
  const row = own.row ?? null;
  const read = (map: unknown) => { const b = bindings(map, row); return b ? resolveBindings(b, (ref) => (ref === VIEWER_ID ? viewerId(island) : store.getValue(ref))) : undefined; };
  // The server render has no transport: it says what today's served page says until the check answers.
  const unavailable = storeRead(store, () => (name ? (isServer ? ACCESS_PENDING : store.mutationUnavailable(name)) : null), { value: name ? ACCESS_PENDING : null });
  const [error, setError] = createSignal<string | null>(null);
  const alert = <Show when={error()}><span role="alert" class="mx-write-error">{error()}</span></Show>;
  if (row) {
    const scope = own.rowScope;
    if (!scope?.durable || !stableRowKey(scope.key)) return <span role="alert">Row actions require a stable row key</span>;
    const [pending, setPending] = createSignal(false);
    const click = () => {
      if (!name || unavailable() !== null || pending() || rest.disabled === true) return;
      const snapshot = scalarRow(row);
      const values = read(own.set);
      if (values) store.setValues(values);
      setError(null); setPending(true);
      store.mutate(name, read(own.args) ?? {}, snapshot).catch((e: unknown) => setError(messageOf(e))).finally(() => setPending(false));
    };
    return <><button data-slot="button" data-variant={variant} data-size={size} {...rest} type="button" disabled={unavailable() !== null || pending() || rest.disabled === true}
      aria-busy={pending() || undefined} aria-description={refusalText(unavailable()) ?? undefined} on:click={click} />{alert}</>;
  }
  const busy = storeRead(store, () => !!name && store.mutating().has(name));
  const click = () => {
    setError(null);
    const values = read(own.set);
    if (values) store.setValues(values);
    if (name) store.mutate(name, read(own.args)).catch((e: unknown) => setError(messageOf(e)));
  };
  return <><button data-slot="button" data-variant={variant} data-size={size} {...rest} aria-busy={busy() || undefined} disabled={busy() || unavailable() !== null || rest.disabled === true}
    aria-description={refusalText(unavailable()) ?? undefined} on:click={click} /><Show when={unavailable()}><span class="text-xs text-muted-foreground">{refusalText(unavailable())}</span></Show>{alert}</>;
}
