/**
 * The ONE view composition for a served markup document, rendered by BOTH
 * ends of the wire — the server (`renderToString`
 * inside lib/story/document.ts) and the in-iframe hydration entry
 * (lib/story-runtime/entry.tsx). One module on both sides is what makes
 * hydration match by construction: any divergence would be a hydration
 * mismatch, so there is deliberately nowhere to diverge.
 *
 * Composition: the kit registry as-is (the view-mode Grid/Video/Slide
 * components are already the right ones in a REAL document — no svg surface,
 * no foreignObject workarounds) plus lean adapters for the three data embeds.
 * The adapters wire the same components the parent-page view uses
 * (QuestionEmbed / InlineNumber / StoryParamControl — chart rendering is never
 * reimplemented) to a local param-state context, seeded `{}` exactly like
 * StoryJsxBody's view mode. Embeds consume `refData` from props — no network
 * from inside the document, which is what lets it live in an opaque-origin
 * sandbox.
 */
import { cloneElement, createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { JsxElement } from '@/lib/jsx';
import type { ComponentType } from 'react';
import { renderStoryNodes, type BoundControlProps, type BoundSourceProps } from '@/lib/story-ui/interpreter';
import { useNodeKeys } from '@/lib/story-ui/use-node-keys';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { resolveRefProps, type RefDataMap } from '@/lib/story/ref-data';
import { IconGlyphProvider } from '@/components/kit/icon';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
// The leaf module, not story-viz: the <Question> write-back also imports the
// editor's AST path (jsx-edit → lib/jsx → acorn), which drags the JSX parser
// into every reader's download for a number
// (lib/__tests__/reader-bundle-hygiene.test.ts).
import { questionEmbedHeightPx } from '@/lib/data/story/question-height';
import { discoverSlides, MIN_SLIDES_FOR_RAIL, type DiscoveredSlide } from './slides';
import { discoverOutline, hasOutline, type OutlineEntry } from './outline';
import QuestionEmbed from '@/components/views/story/QuestionEmbed';
import InlineNumber, { type NumberAgg } from '@/components/views/story/InlineNumber';
import { createDataflowStore, EMPTY_STATE, type DataflowStore } from './store';
import { EMPTY_DATAFLOW, coerceScalarInput, refName, resolveRefTemplate, type Dataflow, type DataflowState, type Row, type Scalar, type ScalarValueDecl, type TableResult } from '@/lib/story/dataflow';
import { isWebUrl, runtimeAssetUrl } from '@/lib/story/asset-url';
import { Button } from '@/components/kit/button';
import { DataTable } from '@/components/kit/data-table';
import { Files } from '@/components/kit/files';
import { GridItemContext } from '@/components/kit/grid';
import { DateControl, SegmentedControl, SelectControl, SliderControl, SwitchControl, normalizeControlOptions, num, shellRest, str } from '@/components/kit/controls';
import { parseColumnSpecs, parseSortSpec, parseTableHeight, type SortSpec } from '@/lib/story/data-table';

export type { StoryIslandData } from './contract';
import type { StoryIslandData } from './contract';

/**
 * What every embed and bound control reads: the document's data (one store
 * snapshot — identity-stable between changes) plus the setter, and the
 * ref-resolved recipes/images. `pending` names the queries a re-run has in
 * flight, so an embed says "loading" only about its OWN table.
 */
interface RuntimeEmbedContextValue {
  /**
   * The store itself, for the one consumer that needs more than a snapshot:
   * a `<Button run>` performs a write and watches its in-flight set. Every
   * other consumer reads the fields below, which are already snapshot-stable.
   */
  store: DataflowStore | null;
  flow: Dataflow;
  state: DataflowState;
  pending: ReadonlySet<string>;
  setValue: (name: string, value: Scalar) => void;
  /** A window of one query's rows through the transport (a table reading past the cap). */
  fetchPage: DataflowStore['fetchPage'];
  refData: RefDataMap;
  /**
   * FALSE inside a `chrome=0` capture. An embed that must draw differently for
   * a photograph reads it here rather than being told by the author: `<Files>`
   * draws glyphs instead of every child's own og card, because a capture that
   * waits on N captures is not a capture (and a private child's is a 404 to the
   * session-less browser taking the shot).
   */
  chrome: boolean;
  glyphs?: GlyphMap;
  colorMode: 'light' | 'dark';
}

const RuntimeEmbedContext = createContext<RuntimeEmbedContextValue>({
  store: null,
  flow: EMPTY_DATAFLOW,
  state: EMPTY_STATE,
  pending: new Set(),
  setValue: () => {},
  fetchPage: () => Promise.reject(new Error('no store')),
  refData: {},
  chrome: true,
  glyphs: {},
  colorMode: 'light',
});

/**
 * WHERE A RUNTIME-COMPUTED IMAGE URL IS SERVED FROM.
 *
 * `endpoint` is the document's own asset import address (StoryIslandData
 * `assetsUrl`); `seen` is the small set of URLs the browser has actually
 * LOADED, which is the only evidence this side has that we hold a copy. It
 * starts empty on both ends of the wire deliberately — see `runtimeAssetUrl`:
 * the island carries no asset lookup, so a server that knew more than the
 * hydrating client would hand React a mismatch and lose the whole server tree.
 *
 * A mutable Set rather than state: recording a load must not re-render (the
 * image is already on screen — a re-render would only swap its src for an
 * equivalent one and fetch again). The next render that happens for its own
 * reasons picks the shorter address up.
 */
interface RuntimeAssetContextValue {
  endpoint: string | null;
  seen: Set<string>;
  /**
   * The document's transport, when it has one that can import (the RELAY —
   * lib/story-runtime/document-transport). Present means FRAMED, and framed
   * means the element cannot do this for itself: the frame is opaque-origin, so
   * its `<img>` carries no cookie and a private document's endpoint answers the
   * uniform 404 — for its OWNER's copy as much as for a stranger. When it is
   * here it is the AUTHORITY: the element's own load and error are ignored,
   * because the load that fails is the one we already know cannot succeed.
   */
  importAsset?: (url: string) => Promise<{ url: string } | { refused: string }>;
}

const RuntimeAssetContext = createContext<RuntimeAssetContextValue>({ endpoint: null, seen: new Set() });

/**
 * The LIVE bound image source (the interpreter's `boundSource` seam):
 * `<img src="$pick">` or `<img src="https://cdn.x.com/{$pick}.png">` resolved
 * against the store and mapped to our own copy.
 *
 * Three states, and each is a thing a reader can see:
 *  - resolved → the mapped address, with `onLoad` recording that we hold it;
 *  - unresolved (the value is null, nothing picked yet) → no src, so the alt
 *    text stands in, and the binding named on `data-mx-bound`;
 *  - REFUSED (the endpoint said no: a link-local address, a non-image, over the
 *    cap, past the document's hourly allowance) → no src plus
 *    `data-mx-asset="refused"`, which is the only signal there is. Nothing is
 *    warned at publish for a bound source, because nothing was fetched then.
 *
 * The refusal is remembered per URL, not per element: the reader can pick
 * something else and come back, and the answer for a URL does not change
 * within a view.
 */
function RuntimeBoundSource({ props, template }: BoundSourceProps) {
  const { state } = useContext(RuntimeEmbedContext);
  const { endpoint, seen, importAsset } = useContext(RuntimeAssetContext);
  const [refused, setRefused] = useState<ReadonlySet<string>>(EMPTY_REFUSED);
  /** Addresses the PAGE resolved for us — the relay's answers, url → /assets/<hash>. */
  const [relayed, setRelayed] = useState<ReadonlyMap<string, string>>(EMPTY_RELAYED);
  const el = useRef<HTMLImageElement | null>(null);
  const url = resolveRefTemplate(template, (name) => state.values[name]);
  /*
   * The image the SERVER rendered has usually finished — or failed — before
   * React hydrates, and an event that already fired is one no listener will
   * ever hear. Both halves matter: without this the first picture a reader sees
   * is never recorded (so coming back to it asks the endpoint again), and a
   * first picture the endpoint REFUSED never gets its mark, so the document
   * shows an empty box instead of the alt text. `complete` is the same pair of
   * facts asked rather than awaited — done with pixels is a load, done without
   * them is an error. (Only a real browser can show this: jsdom fetches no
   * images at all, so the gate is this rule's test.)
   *
   * Skipped entirely when the page is importing for us: that request is the one
   * we already know cannot succeed, and letting its failure mark the image
   * would race the answer that works.
   */
  useEffect(() => {
    const img = el.current;
    if (importAsset || !url || !img || !img.complete) return;
    if (img.naturalWidth > 0) { if (isWebUrl(url)) seen.add(url); return; }
    setRefused((prev) => (prev.has(url) ? prev : new Set([...prev, url])));
  }, [url, seen, importAsset]);
  /*
   * FRAMED: ask the page, once per URL. The first render is deliberately left
   * alone — it has to be byte-identical to what the server sent, which knows
   * nothing about transports — so the endpoint address paints first and this
   * replaces it. On a public document that first request succeeds and the
   * replacement is a cache hit; on a private one it is the only thing that
   * works. Either way the reader never sees a flash, because the src is only
   * ever swapped for another address of the same picture.
   */
  useEffect(() => {
    // `isWebUrl` here for the same reason `runtimeAssetUrl` refuses one: a value
    // we would not import is not a value to ask the page about either.
    if (!importAsset || !url || !isWebUrl(url) || relayed.has(url) || refused.has(url)) return;
    let live = true;
    void importAsset(url).then((answer) => {
      if (!live) return;
      if ('url' in answer) {
        seen.add(url);
        setRelayed((prev) => new Map([...prev, [url, answer.url]]));
      } else {
        setRefused((prev) => (prev.has(url) ? prev : new Set([...prev, url])));
      }
    });
    return () => { live = false; };
  }, [url, importAsset, relayed, refused, seen]);

  const held = url === null ? undefined : relayed.get(url);
  const mapped = held ?? (url === null ? null : runtimeAssetUrl(url, (u) => seen.has(u), endpoint));
  /*
   * A web URL that came back unchanged is one there is no endpoint to import it
   * through — a rail preview, a canvas. It renders STATIC rather than reaching
   * the third-party host: not importing it is the whole point.
   *
   * A NULL is the mapping refusing the value outright (not an http(s) URL at
   * all), which is a REFUSAL a reader should see named, not a quiet blank: the
   * bound path sets `src` itself and so goes round the interpreter's own
   * scheme filter, and this is where that is answered.
   */
  const unmappable = url !== null && !held && mapped === url && isWebUrl(url) && !importAsset;
  const notASource = url !== null && !held && mapped === null;
  if (url === null || unmappable || notASource || refused.has(url)) {
    const marked = url !== null && (notASource || refused.has(url));
    return <img {...props} data-mx-bound={`src:${template}`} {...(marked ? { 'data-mx-asset': 'refused' } : {})} />;
  }
  return (
    <img
      {...props}
      ref={el}
      src={mapped ?? undefined}
      onLoad={() => { if (!importAsset && isWebUrl(url)) seen.add(url); }}
      onError={() => { if (!importAsset) setRefused((prev) => new Set([...prev, url])); }}
    />
  );
}

const EMPTY_RELAYED: ReadonlyMap<string, string> = new Map();

const EMPTY_REFUSED: ReadonlySet<string> = new Set();

/**
 * The LIVE bound control (the interpreter's `boundControl` seam): a native
 * `<select>`/`<input>`/`<textarea>` whose value is the store's, and whose
 * change writes the store — coerced to the bound Value's declared type, so a
 * range slider yields a number and a checkbox a boolean, and an empty choice
 * is null (which is how "$region is null" in SQL means "all"). A `<select
 * options="$table">` lists the table's first column as values and its second
 * (when present) as labels; a scalar declared without a default gets an
 * "All" entry first, because null must be selectable to be meaningful.
 */
function RuntimeBoundControl({ tag, props, bind, children }: BoundControlProps) {
  const { flow, state, setValue } = useContext(RuntimeEmbedContext);
  const declOf = (name: string): ScalarValueDecl | undefined =>
    flow.values.find((v): v is ScalarValueDecl => v.kind === 'scalar' && v.name === name);
  const coerce = (name: string, raw: string): Scalar => coerceScalarInput(declOf(name)?.type, raw);
  const current = (name: string | undefined): string =>
    name === undefined || state.values[name] === null || state.values[name] === undefined ? '' : String(state.values[name]);

  if (tag === 'select') {
    const table = bind.options ? state.tables[bind.options] : undefined;
    const [valueCol, labelCol] = table?.columns ?? [];
    const nullable = bind.value ? (declOf(bind.value)?.default ?? null) === null : false;
    return (
      <select
        {...props}
        value={current(bind.value)}
        onChange={(e) => { if (bind.value) setValue(bind.value, coerce(bind.value, e.target.value)); }}
      >
        {table && nullable ? <option value="">All</option> : null}
        {table && valueCol
          ? table.rows.map((row, i) => {
            const v = String(row[valueCol.name] ?? '');
            const label = labelCol ? String(row[labelCol.name] ?? v) : v;
            return <option key={`${i}:${v}`} value={v}>{label}</option>;
          })
          : null}
        {children}
      </select>
    );
  }
  if (tag === 'textarea') {
    return (
      <textarea
        {...props}
        value={current(bind.value)}
        onChange={(e) => { if (bind.value) setValue(bind.value, coerce(bind.value, e.target.value)); }}
      />
    );
  }
  const type = typeof props.type === 'string' ? props.type : 'text';
  if (bind.checked && (type === 'checkbox' || type === 'radio')) {
    return (
      <input
        {...props}
        checked={state.values[bind.checked] === true}
        onChange={(e) => { setValue(bind.checked!, e.target.checked); }}
      />
    );
  }
  return (
    <input
      {...props}
      value={current(bind.value)}
      onChange={(e) => { if (bind.value) setValue(bind.value, coerce(bind.value, e.target.value)); }}
    />
  );
}

/**
 * The live wiring every kit control adapter shares: the bound scalar's
 * declaration (for typed coercion and the "all" entry), its current value as
 * a control-facing string, and the typed writer. `name` null (an unbound
 * control in a live document) leaves `write` undefined — the control renders
 * disabled, same as the static face.
 */
function useScalarControl(name: string | null) {
  const { flow, state, setValue } = useContext(RuntimeEmbedContext);
  const decl = name ? flow.values.find((v): v is ScalarValueDecl => v.kind === 'scalar' && v.name === name) : undefined;
  return {
    state,
    nullable: name !== null && (decl?.default ?? null) === null,
    current: name !== null && state.values[name] !== null && state.values[name] !== undefined ? String(state.values[name]) : null,
    write: name === null ? undefined : (raw: string | null) => setValue(name, raw === null ? null : coerceScalarInput(decl?.type, raw)),
    writeBool: name === null ? undefined : (next: boolean) => setValue(name, next),
    isTrue: name !== null && state.values[name] === true,
    asNumber: name !== null && typeof state.values[name] === 'number' ? (state.values[name] as number) : null,
  };
}

function SelectAdapter(props: Record<string, unknown>) {
  const { state } = useContext(RuntimeEmbedContext);
  const bind = useScalarControl(refName(props.value));
  const optsName = refName(props.options);
  const options = normalizeControlOptions(props.options, optsName ? state.tables[optsName] : undefined);
  return (
    <SelectControl
      label={str(props.label)} placeholder={str(props.placeholder)} className={str(props.className)}
      options={options} value={bind.current} nullable={bind.nullable}
      onChange={bind.write} rest={shellRest(props)}
    />
  );
}

function SegmentedAdapter(props: Record<string, unknown>) {
  const { state } = useContext(RuntimeEmbedContext);
  const bind = useScalarControl(refName(props.value));
  const optsName = refName(props.options);
  const options = normalizeControlOptions(props.options, optsName ? state.tables[optsName] : undefined);
  return (
    <SegmentedControl
      label={str(props.label)} placeholder={str(props.placeholder)} className={str(props.className)}
      options={options} value={bind.current} nullable={bind.nullable}
      onChange={bind.write} rest={shellRest(props)}
    />
  );
}

function SliderAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(refName(props.value));
  return (
    <SliderControl
      label={str(props.label)} className={str(props.className)}
      min={num(props.min, 0)} max={num(props.max, 100)}
      step={typeof props.step === 'number' ? props.step : undefined}
      format={str(props.format)} prefix={str(props.prefix)} suffix={str(props.suffix)}
      value={bind.asNumber} onChange={bind.write} rest={shellRest(props)}
    />
  );
}

function DatePickerAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(refName(props.value));
  return (
    <DateControl
      label={str(props.label)} className={str(props.className)}
      min={str(props.min)} max={str(props.max)}
      value={bind.current} nullable={bind.nullable} onChange={bind.write} rest={shellRest(props)}
    />
  );
}

function SwitchAdapter(props: Record<string, unknown>) {
  const bind = useScalarControl(typeof props.checked === 'string' ? refName(props.checked) : null);
  return (
    <SwitchControl
      label={str(props.label)} className={str(props.className)}
      checked={bind.isTrue} onChange={bind.writeBool} rest={shellRest(props)}
    />
  );
}

/**
 * The LIVE `<Button run="$add">`: a click performs the named `<Mutation>` with
 * the document's current values (lib/story-runtime/store mutate), and the
 * queries reading the dataset it wrote re-run on their own — so the click that
 * adds a row is the click that redraws the chart.
 *
 * Three things it owes the reader while that happens: it is `aria-busy` and
 * disabled for the duration (a double click is one write, enforced in the
 * store as well as here), a refusal is SHOWN rather than swallowed — the
 * server's own message, in a role="alert" beside the button, because a button
 * that silently does nothing is the failure this whole path exists to avoid —
 * and the message clears on the next attempt.
 */
function ButtonAdapter(props: Record<string, unknown>) {
  const { store } = useContext(RuntimeEmbedContext);
  const name = typeof props.run === 'string' ? refName(props.run) : null;
  const [error, setError] = useState<string | null>(null);
  // Hooks run unconditionally (an unbound Button renders through the same
  // component); the subscription is a no-op when there is no store.
  const busy = useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    () => (store && name ? store.mutating().has(name) : false),
    () => false,
  );
  const { run: _run, children, ...rest } = props;
  if (!name || !store) return <Button {...(rest as Record<string, unknown>)} run={props.run}>{children as ReactNode}</Button>;
  return (
    <>
      <Button
        {...(rest as Record<string, unknown>)}
        aria-busy={busy || undefined}
        disabled={busy || undefined}
        onClick={() => {
          setError(null);
          store.mutate(name).catch((e: unknown) => setError(e instanceof Error ? e.message : 'that did not save'));
        }}
      >
        {children as ReactNode}
      </Button>
      {error ? <span role="alert" className="mx-write-error">{error}</span> : null}
    </>
  );
}

function QuestionAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  // The SAME sizing contract as the editor canvas (StoryJsxBody) — a chart
  // must not change height between editing and reading, and inside a GridItem
  // the CELL is the single source of height: a fixed default here is what
  // clipped every tall recipe (the trend card's sparkline) at the tile edge.
  const inGridItem = useContext(GridItemContext);
  const bare = (props.viz as { kind?: string } | undefined)?.kind === 'single_value';
  const h = questionEmbedHeightPx(props.height, bare);
  // A re-run in flight keeps the current rows on screen (no flash) and says so.
  const table = refName(props.data);
  const busy = table !== null && ctx.pending.has(table);
  return (
    <div
      aria-label="Question embed"
      aria-busy={busy}
      className={busy ? 'mx-busy' : undefined}
      style={{ width: '100%', height: inGridItem ? '100%' : `${h}px` }}
      /* A chart is most of a screen: a reader parked on one is parked HERE, and
         without the stamp the anchor could only name the wrapper around the
         whole document (lib/story/scroll-anchor). */
      {...{ [AST_PATH_ATTR]: props[AST_PATH_ATTR] as string | undefined }}
    >
      <QuestionEmbed
        data={props.data}
        viz={props.viz as Record<string, unknown> | undefined}
        title={typeof props.title === 'string' ? props.title : undefined}
        colorMode={ctx.colorMode}
        tables={ctx.state.tables}
        tableErrors={ctx.state.errors}
        pendingTables={ctx.pending}
        refData={ctx.refData}
      />
    </div>
  );
}

function NumberAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  const table = refName(props.data);
  const busy = table !== null && ctx.pending.has(table);
  // The figure stays while its query re-runs (no flash to a dash); the wrapper
  // says so — dimmed by the embed CSS, announced by aria-busy.
  return (
    <span aria-busy={busy} className={busy ? 'mx-busy-inline' : undefined}>
      <InlineNumber
        data={props.data}
        col={typeof props.col === 'string' ? props.col : undefined}
        agg={typeof props.agg === 'string' ? (props.agg as NumberAgg) : undefined}
        prefix={typeof props.prefix === 'string' ? props.prefix : undefined}
        suffix={typeof props.suffix === 'string' ? props.suffix : undefined}
        format={typeof props.format === 'string' ? props.format : undefined}
        tables={ctx.state.tables}
      />
    </span>
  );
}

/** How many rows one window read brings in. */
const TABLE_PAGE = 500;

/**
 * `<DataTable data="$name" columns sort height sticky>` — the live table. Its
 * rows are the store's until the reader asks for more of a truncated result:
 * then windows come through the store's page transport (sorted by the engine,
 * because sorting a sample locally would lie) and are held here. A store
 * update (a value changed, the query re-ran) resets to the store's rows.
 */
function DataTableAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  // An `image` column's cells go through the SAME mapping a bound <img src>
  // does — one function, so a URL in a table and a URL in the markup are
  // served from the same place and imported through the same door.
  const { endpoint, seen } = useContext(RuntimeAssetContext);
  const resolveSrc = useMemo(() => (url: string) => {
    // Null both ways: the mapping refused the value, or there is no endpoint to
    // import a web URL through. Either way the cell stays text (kit data-table).
    const mapped = runtimeAssetUrl(url, (u) => seen.has(u), endpoint);
    return mapped === url && isWebUrl(url) ? null : mapped;
  }, [endpoint, seen]);
  // Same cell contract as QuestionAdapter: inside a GridItem the cell sizes the embed.
  const inGridItem = useContext(GridItemContext);
  const name = refName(props.data);
  const table = name ? ctx.state.tables[name] : undefined;
  const spec = useMemo(() => parseColumnSpecs(props.columns), [props.columns]);
  const authoredSort = useMemo(() => parseSortSpec(props.sort), [props.sort]);
  // A CEILING, not a reserved height (the kit's scroll box caps itself): outside a
  // grid cell the wrapper leaves the table to hug its rows, and the cap is the TABLE
  // parser's — questionEmbedHeightPx floors at MIN_CHART_H, a chart rule that would
  // turn an authored height="120px" into a 340px box.
  const cap = parseTableHeight(props.height);
  const wrapper: CSSProperties = inGridItem ? { width: '100%', height: '100%' } : { width: '100%' };

  const [extra, setExtra] = useState<{ base: TableResult | undefined; rows: Row[]; sort: SortSpec | null; loading: boolean }>({ base: table, rows: [], sort: authoredSort, loading: false });
  const paged = extra.base === table ? extra : { base: table, rows: [], sort: authoredSort, loading: false };
  // Two quick header clicks are two window reads; only the LATEST may land.
  const readSeq = useRef(0);

  const readWindow = (offset: number, sort: SortSpec | null, replace: boolean) => {
    if (!name || !table) return;
    const seq = ++readSeq.current;
    setExtra({ base: table, rows: replace ? [] : paged.rows, sort, loading: true });
    ctx.fetchPage(name, { offset, limit: TABLE_PAGE, sort: sort ?? undefined }).then(
      (win) => { if (seq === readSeq.current) setExtra((prev) => (prev.base === table ? { base: table, rows: replace ? win.rows : [...prev.rows, ...win.rows], sort, loading: false } : prev)); },
      () => { if (seq === readSeq.current) setExtra((prev) => (prev.base === table ? { ...prev, loading: false } : prev)); },
    );
  };

  if (!table) {
    const error = name ? ctx.state.errors[name] : undefined;
    const pending = name !== null && ctx.pending.has(name);
    return (
      <div aria-label="DataTable embed" className="flex w-full flex-col items-center justify-center gap-2.5 rounded-md border border-border p-4 text-sm text-muted-foreground" style={wrapper}>
        {/* Pending speaks the platform loading lockup (see QuestionEmbed's `waiting`). */}
        {pending ? (
          <>
            <span aria-hidden="true" className="size-[22px] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">loading data…</span>
          </>
        ) : !name ? 'data unavailable — bind a declared table with data="$name"'
          : error ? `query "${name}" failed: ${error}`
          : `data unavailable — "$${name}" has no rows yet`}
      </div>
    );
  }
  const truncated = !!table.truncated;
  // Unsorted windows APPEND to the sample; a sorted read REPLACES it, so the
  // rows on screen are exactly the engine's order for that sort.
  const shown = paged.sort && paged.rows.length ? paged.rows : [...table.rows, ...paged.rows];
  const busy = name !== null && ctx.pending.has(name);
  return (
    <div aria-label="DataTable embed" aria-busy={busy} className={busy ? 'mx-busy' : undefined} style={wrapper}>
      <DataTable
        rows={shown}
        columns={table.columns}
        spec={spec}
        sort={authoredSort}
        height={cap}
        sticky={props.sticky !== false}
        totalRows={table.totalRows}
        truncated={truncated}
        loading={paged.loading}
        resolveSrc={resolveSrc}
        onSortChange={truncated ? (sort) => readWindow(0, sort, true) : undefined}
        onLoadMore={truncated ? () => readWindow(shown.length, paged.sort, false) : undefined}
      />
    </div>
  );
}

/**
 * `<Files data="$q">` — a bound LISTING, live. The rows are the store's,
 * exactly like every other bound embed: the document's own <Query> over
 * `ref_<folderId>` runs through the transport its island already names, so the
 * listing follows a child being created or moved with no reload (lib/folders
 * notifyParent wakes the folder's channel, and the store re-runs the query the
 * ping dirties).
 */
function FilesAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  const name = refName(props.data);
  const table = name ? ctx.state.tables[name] : undefined;
  return (
    <Files
      rows={table?.rows}
      variant={typeof props.variant === 'string' ? props.variant : undefined}
      capture={!ctx.chrome}
    />
  );
}

const RUNTIME_REGISTRY: Record<string, ComponentType<Record<string, unknown>>> = {
  ...STORY_UI_COMPONENTS,
  Files: FilesAdapter,
  Question: QuestionAdapter,
  Number: NumberAdapter,
  DataTable: DataTableAdapter,
  // The kit controls, live: resolved from the store, writing back typed.
  Select: SelectAdapter,
  Segmented: SegmentedAdapter,
  Slider: SliderAdapter,
  DatePicker: DatePickerAdapter,
  Switch: SwitchAdapter,
  // The one TRIGGER: a click writes (lib/story/dataflow REF_ATTRS Button.run).
  Button: ButtonAdapter,
};

/**
 * The rail's miniature of a slide: the slide's OWN nodes re-rendered into a
 * fixed 1280×800 box and scaled down, so a preview is always current and
 * nothing has to be captured, timed, or rasterized (the old rail's thumbnails
 * were raster captures that landed late and pushed rows around).
 *
 * Embeds render as inert placeholders here on purpose: a chart mounted twice
 * means two live vega instances per slide, which is the whole cost the raster
 * approach existed to avoid. Layout stays faithful; only the paint is stubbed.
 */
const PREVIEW_EMBED = (label: string) => {
  // The same register as the loading lockup, minus the spinner: a rail
  // preview is a deliberate stub, not something in flight — same voice,
  // different claim. Token vars with fallbacks (inline styles, because the
  // rail scales previews).
  const Placeholder = () => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
      minHeight: 120, border: '1px solid var(--border, rgba(128,128,128,0.35))', borderRadius: 6,
      background: 'color-mix(in srgb, var(--muted-foreground, gray) 6%, transparent)',
      font: '500 11px/1 var(--font-mono, ui-monospace, monospace)', letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--muted-foreground, graytext)',
    }}>{label}</div>
  );
  Placeholder.displayName = `Preview${label}`;
  return Placeholder;
};

const PREVIEW_REGISTRY: Record<string, ComponentType<Record<string, unknown>>> = {
  ...STORY_UI_COMPONENTS,
  Question: PREVIEW_EMBED('chart'),
  Number: PREVIEW_EMBED('#'),
  DataTable: PREVIEW_EMBED('table'),
  // A player is a live cross-origin frame; a preview of one is a box.
  Video: PREVIEW_EMBED('video'),
};

function SlideRail({ slides, active, onGo, onRename }: {
  slides: DiscoveredSlide[];
  active: number;
  onGo: (index: number) => void;
  /** Present only while the owner is editing: renaming is the rail's one edit. */
  onRename?: (path: string, title: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <nav className="mx-rail" aria-label="Slides">
      {slides.map((slide) => (
        <button
          key={slide.index}
          type="button"
          className="mx-rail-row"
          aria-label={`Go to slide ${slide.index + 1}: ${slide.title}`}
          aria-current={slide.index === active}
          onClick={() => onGo(slide.index)}
        >
          <span className="mx-rail-label">
            <span className="mx-rail-index">{slide.index + 1}</span>
            {onRename && renaming === slide.path ? (
              <input
                className="mx-rail-title"
                aria-label={`Slide ${slide.index + 1} title`}
                defaultValue={slide.title}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { onRename(slide.path, e.currentTarget.value); setRenaming(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRename(slide.path, e.currentTarget.value); setRenaming(null); }
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="mx-rail-title">{slide.title}</span>
            )}
            {onRename && renaming !== slide.path && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Edit slide ${slide.index + 1} title`}
                className="mx-rail-rename"
                onClick={(e) => { e.stopPropagation(); setRenaming(slide.path); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setRenaming(slide.path); } }}
              >
                ✎
              </span>
            )}
          </span>
          <span className="mx-rail-thumb" aria-hidden="true">
            {/* The slide renders at its REAL size inside the miniature and is
                scaled down, so the preview is the slide's own composition.
                `--mx-vh` is pinned locally: a slide sizes itself against the
                viewport, and in here the viewport is this box. */}
            <div style={{ ['--mx-vh' as string]: '800px' }}>
              {renderStoryNodes([slide.node], { components: PREVIEW_REGISTRY })}
            </div>
          </span>
        </button>
      ))}
    </nav>
  );
}

function PresentBar({ active, total, footerInset, onGo }: { active: number; total: number; footerInset: number; onGo: (index: number) => void }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    // Both spellings, for the same reason as toggleFullscreen below: Safari
    // fires only the webkit-prefixed event, so the label would have stayed on
    // "present" through a presentation the reader was already in.
    const sync = () => setFull(!!(document.fullscreenElement
      ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  // Keyboard is how a deck is actually driven once it is on a screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); onGo(active + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); onGo(active - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onGo]);

  const toggleFullscreen = () => {
    /*
     * Fullscreen from inside a frame needs the host to allow it — the surface
     * sets allow="fullscreen" on the iframe. Failing is harmless: paging works.
     *
     * Safari only exposes the webkit-prefixed form (it has no unprefixed
     * `requestFullscreen` on older versions), and the optional call plus the
     * swallowed rejection meant `present` there did precisely nothing, with no
     * way for the reader to tell why.
     */
    type WebkitFullscreen = {
      webkitRequestFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
      webkitFullscreenElement?: Element | null;
    };
    const doc = document as Document & WebkitFullscreen;
    const root = document.documentElement as HTMLElement & WebkitFullscreen;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) void doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else if (root.requestFullscreen) {
      void root.requestFullscreen().catch(() => {});
    } else {
      root.webkitRequestFullscreen?.();
    }
  };

  return (
    <div
      className="mx-present"
      aria-label="Slide controls"
      style={{ ['--mx-footer-inset' as string]: `${footerInset}px` }}
    >
      <button type="button" aria-label="Previous slide" onClick={() => onGo(active - 1)}>‹</button>
      <span className="mx-present-count" aria-label="Slide position">{active + 1} / {total}</span>
      <button type="button" aria-label="Next slide" onClick={() => onGo(active + 1)}>›</button>
      <button type="button" aria-label={full ? 'Exit presentation' : 'Present'} onClick={toggleFullscreen}>
        {full ? 'exit' : 'present'}
      </button>
    </div>
  );
}

/**
 * The document's slides — the ones a reader scrolls, NOT the miniatures in the
 * rail. A preview renders a real `<Slide>`, stamps included, so an unscoped
 * query counts every slide twice and the counter reads "4 / 3".
 */
const documentSlides = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('.mx-doc [data-mx-slide]')];

/**
 * THE OUTLINE — a sectioned document's table of contents, as chrome
 * (lib/story-runtime/outline). Rendered here beside the body exactly as the
 * deck rail is: a flex sibling in the SSR string at its final width, so the
 * reader never sees the column jump.
 *
 * INERT MARKUP, deliberately. A document of prose — the kind that has
 * sections — ships no runtime, so a React handler here would never exist for
 * the reader who needs it most. Each row names its heading by path
 * (`data-mx-target`); the ~1 KB entry every document loads wires the click and
 * the current-section mark from plain DOM (lib/story-runtime/outline-nav).
 * Rows are keyed by path so a live update keeps their DOM nodes, marks and all.
 */
function OutlineRail({ entries }: { entries: OutlineEntry[] }) {
  let section = 0;
  return (
    <nav className="mx-outline" aria-label="Contents">
      <div className="mx-outline-label">Contents</div>
      {entries.map((entry) => {
        if (entry.level === 2) section += 1;
        return (
          <button
            key={entry.path}
            type="button"
            className={entry.level === 3 ? 'mx-outline-row mx-outline-sub' : 'mx-outline-row'}
            aria-label={entry.level === 2 ? `Go to section ${section}: ${entry.title}` : `Go to ${entry.title}`}
            data-mx-target={entry.path}
          >
            {entry.title}
          </button>
        );
      })}
    </nav>
  );
}

/** Slide navigation over the rendered document — one realm, so plain DOM. */
function useSlideChrome(count: number) {
  const [active, setActive] = useState(0);
  const [footerInset, setFooterInset] = useState(0);

  useEffect(() => {
    if (count === 0) return;
    // The slide crossing the upper third is the one being read; a plain scroll
    // read is exact and needs no observer bookkeeping.
    const onScroll = () => {
      const slides = documentSlides();
      if (!slides.length) return;
      const mark = window.innerHeight / 3;
      let next = 0;
      slides.forEach((el, i) => { if (el.getBoundingClientRect().top <= mark) next = i; });
      setActive(next);

      // The platform credits follow the story root in normal flow. As they
      // enter the viewport, lift the fixed controls by exactly the visible
      // portion so the two pieces of document chrome never cover each other.
      const footer = document.querySelector<HTMLElement>('.mx-artifact-credits');
      const rect = footer?.getBoundingClientRect();
      const visible = rect
        ? Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top))
        : 0;
      setFooterInset(visible);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [count]);

  const go = useMemo(() => (index: number) => {
    const slides = documentSlides();
    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    slides[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return { active, footerInset, go };
}

/**
 * `store` is the document's dataflow store when the caller already holds one
 * (the hydration entry creates it FIRST so `window.mx` exists before the
 * author script; tests inject one). Absent — SSR — one is created from the
 * island's dataflow.
 */
export type StoryRuntimeAppProps = StoryIslandData & {
  store?: DataflowStore;
  /**
   * EDIT MODE, when the owner has entered it (lib/story-runtime/edit/session).
   * Chained after the runtime's own decorator, so a text host becomes editable
   * without anything else about this render changing — same tree, same keys,
   * same mounted charts. Absent for every reader, and the chunk that provides
   * it is loaded only on demand.
   */
  editDecorate?: (element: ReactElement, node: JsxElement, path: string) => ReactNode;
  /**
   * Rename a slide from the deck's own rail. The rail is the DOCUMENT's chrome
   * (lib/story-runtime/slides), so the affordance has to live here; the
   * write-back belongs to the page, as every write-back does.
   */
  onSlideRename?: (path: string, title: string) => void;
  /**
   * Fired once, after the FIRST COMMIT — the moment the hydrated tree exists.
   * The entry runs the author script from here: `hydrateRoot` only schedules
   * (React 19 hydrates concurrently), so "one frame later" could still be
   * before the commit, and a script that touched text inside the root then
   * handed React a mismatch. An effect is the only honest "hydrated" signal.
   */
  onMounted?: () => void;
  /**
   * Import one web URL through the PAGE — the document's transport verb
   * (lib/story-runtime/store QueryTransport.importAsset), threaded here by the
   * entry. Present only for a FRAMED document, and its presence is what makes
   * the page the authority over a bound `<img>`'s source; absent, the element
   * loads the endpoint for itself.
   */
  importAsset?: (url: string) => Promise<{ url: string } | { refused: string }>;
};

const EMPTY_GLYPHS: GlyphMap = {};

/** A store-less subscribe (a Button rendered outside a document): nothing ever changes. */
const NO_SUBSCRIBE = () => () => {};

export function StoryRuntimeApp({ nodes, refData, glyphs, dataflow, colorMode, template = null, chrome = true, assetsUrl = null, importAsset, store: givenStore, onMounted, editDecorate, onSlideRename }: StoryRuntimeAppProps) {
  const [store] = useState<DataflowStore>(() => givenStore ?? createDataflowStore(dataflow ?? { flow: EMPTY_DATAFLOW }));
  const mountedRef = useRef(onMounted);
  mountedRef.current = onMounted;
  useEffect(() => { mountedRef.current?.(); }, []);
  // One snapshot per change (identity-stable) — the server snapshot is the
  // same object the island carried, so SSR and hydration read identical state.
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const pending = store.pending();
  const setValue = useMemo(() => (name: string, value: Scalar) => store.setValue(name, value), [store]);

  // Discovery is a pure walk of the nodes we already hold, so the rail is
  // SERVER-rendered at its final width — no reservation guess, no shift.
  const nodeKeys = useNodeKeys(nodes);
  const slides = useMemo(() => (chrome ? discoverSlides(nodes) : []), [nodes, chrome]);
  const deck = slides.length >= MIN_SLIDES_FOR_RAIL;
  const { active, footerInset, go } = useSlideChrome(deck ? slides.length : 0);
  // A sectioned editorial gets its outline — never scrolly, a deck or a capture.
  const outline = useMemo(() => (chrome && !deck && template === 'editorial' && hasOutline(nodes) ? discoverOutline(nodes) : []), [nodes, template, chrome, deck]);

  // `<img src="ref:<id>">` / `<Video poster="ref:<id>">` → the referenced
  // artifact's URL, through the SAME table the editor uses
  // (lib/story/ref-data). Without it the ref: string reaches the DOM
  // verbatim: a broken image and a CSP violation.
  const decorateElement = useMemo(() => (element: ReactElement, node: JsxElement, path: string) => {
    const patch = resolveRefProps(node, element.props as Record<string, unknown>, refData);
    const resolved = patch ? cloneElement(element as ReactElement<Record<string, unknown>>, patch) : element;
    // Edit mode wraps LAST, so it decorates the element the reader actually sees.
    return editDecorate ? editDecorate(resolved as ReactElement, node, path) : resolved;
  }, [refData, editDecorate]);

  // The URLs the browser has answered, for the life of this document. A ref,
  // not state: see RuntimeAssetContext — recording a load must not re-render.
  const seen = useRef<Set<string>>(null as unknown as Set<string>);
  if (seen.current === null) seen.current = new Set();
  const assets = useMemo(() => ({ endpoint: assetsUrl, seen: seen.current, importAsset }), [assetsUrl, importAsset]);

  const body = (
    <RuntimeAssetContext.Provider value={assets}>
      <RuntimeEmbedContext.Provider value={{ store, flow: store.flow, state, pending, setValue, fetchPage: store.fetchPage, refData, chrome, colorMode }}>
        {renderStoryNodes(nodes, {
          // Identity across an adopted document: a live update re-renders this
          // tree, and positional keys would remount everything below the edit.
          keyFor: nodeKeys.keyFor,
          components: RUNTIME_REGISTRY,
          boundControl: RuntimeBoundControl,
          boundSource: RuntimeBoundSource,
          decorateElement,
        })}
      </RuntimeEmbedContext.Provider>
    </RuntimeAssetContext.Provider>
  );

  /*
   * <Icon> renders from resolved glyph DATA, so the ~1600-glyph set never ships to
   * a reader (lib/story/icon-glyphs). Provided around EVERYTHING the document
   * draws, not just its body: the deck rail re-renders each slide's own nodes to
   * make its previews, so a provider around the body alone gave every rail preview
   * the slide's text and a hole where its icon goes.
   */
  const withGlyphs = (tree: ReactElement) => (
    <IconGlyphProvider value={glyphs ?? EMPTY_GLYPHS}>{tree}</IconGlyphProvider>
  );

  if (!deck) {
    // The column wrapper on EVERY path, chrome or none: it is what the
    // authored `@container` utilities resolve against (STORY_COLUMN_CSS), so a
    // document without a rail must not be measured against something else.
    if (outline.length === 0) return withGlyphs(<div className="mx-doc">{body}</div>);
    return withGlyphs(
      <div className="mx-reading">
        <OutlineRail entries={outline} />
        <div className="mx-doc">{body}</div>
      </div>,
    );
  }

  return withGlyphs(
    <div className="mx-deck">
      <SlideRail slides={slides} active={active} onGo={go} onRename={onSlideRename} />
      <div className="mx-doc">{body}</div>
      <PresentBar active={active} total={slides.length} footerInset={footerInset} onGo={go} />
    </div>,
  );
}
