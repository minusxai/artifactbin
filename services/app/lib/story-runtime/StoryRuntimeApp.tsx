import {PersonMention,PersonMentionProvider} from '@/components/PersonMention';
import {isPersonMentionHref} from '@/lib/person-mentions';
import { MermaidImagesProvider } from '@/components/kit/mermaid-images';
/**
 * The ONE view composition for a served markup document. The registry and
 * adapters are shared by server rendering and the browser runtime, while
 * live query/page data comes from the runtime store and its transport.
 *
 * Composition: the kit registry plus adapters for the current document
 * embeds (Question, Number, DataTable, Files and bound controls). The same
 * components render in the document and receive live query/page data from
 * the runtime store and its transport; refData resolution remains local.
 *
 * The KIT is not imported here: each component (and its live adapter) is a
 * chunk of its own (lib/story-runtime/kit/*), loaded for the documents that
 * draw it and read from the kit registry (./kit-registry). The contexts the
 * adapters read live beside this module (./runtime-context).
 */
import { cloneElement, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import type { ComponentType } from 'react';
import { renderStoryNodes, type BoundControlProps, type BoundSourceProps, type CellControlProps, type RowActionProps } from '@/lib/story-ui/interpreter';
import { useNodeKeys } from '@/lib/story-ui/use-node-keys';
import { resolveRefProps, type ImageAssetAnswer } from '@/lib/story/ref-data';
import { IconGlyphProvider } from '@/components/kit/icon';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
import { discoverSlides, MIN_SLIDES_FOR_RAIL, type DiscoveredSlide } from './slides';
import { discoverOutline, hasOutline, type OutlineEntry } from './outline';
import { createRowActions } from './row-actions';
import { createDataflowStore, type DataflowStore } from './store';
import { coerceScalarInput, refName, type Scalar } from '@/lib/story/dataflow';
import { EMPTY_COMPILED_DATAFLOW, type CompiledValue } from '@/lib/story/compiled-dataflow';
import { VIEWER_ID } from '@/lib/story/builtins';
import { refusalText } from '@/lib/story/sign-in-required';
import { isWebUrl, runtimeAssetUrl } from '@/lib/story/asset-url';
import {boundImageValue,imageReferenceId} from '@/lib/story/image-source';
import { cn } from '@/components/kit/cn';
import type { ManagedAssetRelay } from './managed-assets';
import { createPreviewIdentityAllocator } from './preview-identity';
import { Tooltip } from '@/components/Tooltip';
import { CellSessionsContext, FrozenHint, NO_SUBSCRIBE, RowActionsContext, RuntimeAssetContext, RuntimeEmbedContext, scalarRow, useBindingReader } from './runtime-context';
import { kitComponents, subscribeKit, type KitComponents } from './kit-registry';

/** The disabled input cannot receive focus; its stable wrapper explains why. */
function MutationCellHint({reason,children}:{reason:string|null;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  return <Tooltip content={reason} open={!!reason && open} onOpenChange={setOpen}>
    <span className="inline-flex w-full" tabIndex={reason ? 0 : undefined} aria-description={reason ?? undefined}>{children}</span>
  </Tooltip>;
}

/**
 * The kit as loaded now (./kit-registry): its faces, live faces and cell
 * controls, one snapshot per chunk arrival. A document renders only after the
 * chunks it draws are here, so what it reads is always present.
 */
const useKit = () => useSyncExternalStore(subscribeKit, kitComponents, kitComponents);

/** An authored string prop, or nothing. */
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function RuntimeRowAction({props, row, identity, children}: RowActionProps) {
  // The row's `<Button>`: this tag's chunk is loaded with every document that draws one.
  const Button = (useKit().faces.Button ?? 'button') as ComponentType<Record<string, unknown>>;
  const {store, chrome} = useContext(RuntimeEmbedContext);
  const actions = useContext(RowActionsContext);
  const read = useBindingReader();
  const name = refName(props.run);
  const state = useSyncExternalStore(actions?.subscribe ?? NO_SUBSCRIBE, () => actions?.get(identity), () => undefined);
  const unavailable = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => name && store ? store.mutationUnavailable(name) : 'Checking edit access…', () => 'Checking edit access…');
  const {run: _run, set, args, ...rest} = props;
  return <>
    <Button {...rest} type="button" disabled={!chrome || !actions || unavailable !== null || state?.pending || props.disabled === true}
      aria-busy={state?.pending || undefined} aria-description={refusalText(unavailable) ?? undefined}
      onClick={() => {
        if (!chrome || !actions || !store || !name || unavailable !== null || props.disabled === true) return;
        const snapshot = scalarRow(row);
        const values = read(set);
        if (values) store.setValues(values);
        void actions.run(identity, () => store.mutate(name, read(args) ?? {}, snapshot));
      }}>{children}</Button>
    {state?.error ? <span role="alert" className="mx-write-error">{state.error}</span> : null}
  </>;
}

function RuntimeCellControl({ tag, component: Component, props, row, identity, column, rowKey, tableName, valueField, children }: CellControlProps) {
  const ctx = useContext(RuntimeEmbedContext);
  // The kit controls a cell draws with, from the controls chunk (loaded for any document that draws a Select or DatePicker).
  const cells = useKit().cells;
  const sessions = useContext(CellSessionsContext);
  const read = useBindingReader();
  const name = typeof props.run === 'string' ? refName(props.run) : null;
  const unavailable = useSyncExternalStore(ctx.store?.subscribe ?? NO_SUBSCRIBE, () => name ? ctx.store ? ctx.store.mutationUnavailable(name) : 'Checking edit access…' : 'This cell has no mutation.', () => 'Checking edit access…');
  const writable = unavailable === null;
  const initial = (props.value ?? null) as Scalar;
  const session = useSyncExternalStore(sessions?.subscribe ?? NO_SUBSCRIBE, () => sessions?.get(identity), () => undefined);
  useEffect(() => { sessions?.reconcile(identity, initial); }, [sessions, identity, initial, session?.phase]);
  const begin = () => sessions?.begin(identity, initial, scalarRow(row));
  const cancel = () => sessions?.cancel(identity);
  const change = (value: Scalar) => { begin(); sessions?.change(identity, value); };
  const commit = () => {
    if (!ctx.chrome || !writable || !name || !ctx.store) return;
    void sessions?.commit(identity, (draft, _original, snapshot) => ctx.store!.mutate(name, { ...read(props.args), _value: draft }, { ...snapshot }));
  };
  const value = session ? session.draft : initial;
  const busy = session?.phase === 'pending' || session?.phase === 'saved';
  const { run: _run, defaultValue: _defaultValue, value: _value, 'aria-label': _ariaLabel, disabled: _disabled, exclude: _exclude, ...rest } = props;
  const label = str(props['aria-label']) ?? str(props.label) ?? `${column} ${String(rowKey)}`;
  const error = session?.error ? <span role="alert" className="mx-write-error">{session.error}</span> : null;
  const valueType = tableName ? ctx.state.tables[tableName]?.columns.find((c) => c.name === valueField)?.type : undefined;
  const selectValue = (next: string | null): Scalar => next === null ? null : valueType === 'number' ? next === '' ? null : Number(next) : valueType === 'boolean' ? next === 'true' : next;
  // Cell values remain readable even when the viewer cannot mutate them.
  if (tag === 'Select' && cells) {
    const { SelectControl, selectOptions, shellRest } = cells;
    const options = selectOptions(ctx.state, props.options, `${tableName}.${valueField}`, valueType === 'user')
      .filter((option) => props.exclude === undefined || option.value !== String(props.exclude));
    return <MutationCellHint reason={refusalText(unavailable)}><SelectControl
      appearance="cell" label={label} placeholder={str(props.placeholder) ?? 'None'} className={str(props.className)} options={options}
      value={value === null ? null : String(value)} nullable={props.nullable === true}
      onOpenChange={(open) => { if (open) begin(); }} onChange={(next) => change(selectValue(next))}
      onCommit={commit} onCancel={cancel}
      draftValue={session ? session.draft === null ? null : String(session.draft) : undefined}
      onDraftChange={(next) => change(next)} multiple={valueType!=='user'&&props.multiple === true} allowCreate={valueType!=='user'&&props.allowCreate === true}
      valueFormat={props.valueFormat === 'json' ? 'json' : undefined} disabled={!ctx.chrome || !writable || busy || props.disabled === true}
      rest={{ ...shellRest(rest), 'aria-busy': busy || undefined, 'aria-description': unavailable ?? undefined }}
    >{children}</SelectControl>{error}</MutationCellHint>;
  }
  if (tag === 'DatePicker' && cells) {
    const { DateControl, shellRest } = cells;
    // A pick is the whole edit: stage it and commit in one gesture. A
    // timestamp column shows (and, like the bound DatePicker, writes) its day.
    const shown = typeof value === 'string' ? valueType === 'timestamp' ? value.slice(0, 10) : value : null;
    return <MutationCellHint reason={refusalText(unavailable)}><DateControl
      appearance="cell" label={label} className={str(props.className)} min={str(props.min)} max={str(props.max)}
      value={shown} nullable={props.nullable === true}
      onChange={(next) => { change(next === '' ? null : next); commit(); }}
      disabled={!ctx.chrome || !writable || busy || props.disabled === true}
      rest={{ ...shellRest(rest), 'aria-busy': busy || undefined, 'aria-description': unavailable ?? undefined }}
    />{error}</MutationCellHint>;
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const Html = tag as 'input' | 'textarea' | 'select';
    const commitDraft = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
      if (!element.validity.valid) { element.reportValidity(); return; }
      const active = sessions?.get(identity);
      if (!active || (active.phase !== 'editing' && active.phase !== 'error')) return;
      if (props.type === 'number') {
        const n = active.draft === '' || active.draft === null ? null : Number(active.draft);
        if (n !== null && !Number.isFinite(n)) return;
        sessions?.change(identity, n);
      }
      commit();
    };
    return <MutationCellHint reason={refusalText(unavailable)}><Html {...(rest as Record<string, unknown>)} aria-label={label} aria-description={refusalText(unavailable) ?? undefined} value={value === null ? '' : String(value)} disabled={!ctx.chrome || !writable || busy || props.disabled === true}
      className={cn('w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition-colors hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50', tag === 'textarea' ? 'min-h-8 resize-y' : 'h-8', props.type === 'number' && 'text-right tabular-nums', str(props.className))}
      onFocus={begin} onChange={(e) => { change(tag === 'select' ? selectValue(e.currentTarget.value) : e.currentTarget.value); if (tag === 'select') commitDraft(e.currentTarget); }} onBlur={(e) => commitDraft(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); e.currentTarget.blur(); } else if (e.key === 'Enter' && !(tag === 'textarea' && e.shiftKey)) { e.preventDefault(); commitDraft(e.currentTarget); } }}
    >{tag === 'input' ? undefined : children}</Html>{error}</MutationCellHint>;
  }
  return Component ? <Component {...rest}>{children}</Component> : null;
}

export type { StoryIslandData } from './contract';
import type { StoryIslandData } from './contract';

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
function RuntimeBoundSource(input:BoundSourceProps) {
  const {state}=useContext(RuntimeEmbedContext);
  const value=boundImageValue(input.template,state.values,input.row);
  return value && imageReferenceId(value)
    ? <RuntimeReferenceImage key={value} value={value} props={input.props}/>
    : <RuntimeWebSource {...input}/>;
}

/** Resolve metadata once per reference/query snapshot. Original bytes remain browser-lazy. */
function RuntimeReferenceImage({value,props}:{value:string;props:Record<string,unknown>}) {
  const {endpoint,importAsset,images}=useContext(RuntimeAssetContext);
  const [result,setResult]=useState<{cache:typeof images;answer:ImageAssetAnswer}|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!importAsset)return;
    let live=true;
    let pending=images?.get(value);
    if(!pending){pending=Promise.resolve().then(()=>importAsset(value)).catch(()=>({refused:'unavailable'}));images?.set(value,pending);}
    void pending.then(answer=>{if(live){setResult({cache:images,answer});setFailed(false);}});
    return ()=>{live=false;};
  },[value,importAsset,images]);
  const answer=result?.cache===images ? result?.answer : undefined;
  const unavailable=failed || (answer && 'refused' in answer);
  const {srcSet: authoredSrcSet,srcset: authoredLowerSrcSet,...rest}=props;
  const mapped=unavailable?null:answer&&'url' in answer?answer.url:runtimeAssetUrl(value,()=>false,endpoint);
  if(!mapped)return <img {...rest} data-mx-asset={unavailable?'refused':undefined}/>;
  const image=answer&&'url' in answer ? answer.image??{kind:'image' as const,url:answer.url} : undefined;
  const sourceProps:Record<string,unknown>={...rest,...(authoredSrcSet!==undefined?{srcSet:authoredSrcSet}:{}),...(authoredLowerSrcSet!==undefined?{srcset:authoredLowerSrcSet}:{}),src:value};
  const patch=image?resolveRefProps({tag:'img',isComponent:false},sourceProps,{[imageReferenceId(value)!]:image}):{src:mapped};
  return <img {...sourceProps} {...patch} onError={()=>setFailed(true)}/>;
}

function RuntimeWebSource({ props, template, row }: BoundSourceProps) {
  const { state } = useContext(RuntimeEmbedContext);
  const { endpoint, seen, importAsset } = useContext(RuntimeAssetContext);
  const [refused, setRefused] = useState<ReadonlySet<string>>(EMPTY_REFUSED);
  /** Addresses the PAGE resolved for us — the relay's answers, url → /assets/<hash>. */
  const [relayed, setRelayed] = useState<ReadonlyMap<string, string>>(EMPTY_RELAYED);
  const el = useRef<HTMLImageElement | null>(null);
  const url = boundImageValue(template, state.values, row);
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
    if (!importAsset || !url || (!isWebUrl(url) && !imageReferenceId(url)) || relayed.has(url) || refused.has(url)) return;
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
function RuntimeBoundControl(input: BoundControlProps) {
  const { store } = useContext(RuntimeEmbedContext);
  const name = input.bind.value ?? input.bind.checked;
  const reason = name && store ? store.frozenReason(name) : null;
  if (!reason) return <NativeBoundControl {...input} />;
  return <FrozenHint reason={reason}><NativeBoundControl {...input} props={{ ...input.props, disabled: true, 'aria-description': reason }} /></FrozenHint>;
}

/** Native inputs a reader types or drags through: their bound queries wait for a pause. */
const CONTINUOUS_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'range']);

function NativeBoundControl({ tag, props, bind, children }: BoundControlProps) {
  const { flow, state, setValue } = useContext(RuntimeEmbedContext);
  const declOf = (name: string): CompiledValue | undefined =>
    flow.values.find((v) => v.kind === 'scalar' && v.name === name);
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
        onChange={(e) => { if (bind.value) setValue(bind.value, coerce(bind.value, e.target.value), { debounce: true }); }}
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
      onChange={(e) => { if (bind.value) setValue(bind.value, coerce(bind.value, e.target.value), { debounce: CONTINUOUS_INPUT_TYPES.has(type) }); }}
    />
  );
}

/**
 * The rail's miniature of a slide: the slide's OWN nodes re-rendered into a
 * fixed 1280×800 box and scaled down, so a preview is always current and
 * nothing has to be captured, timed, or rasterized — a raster thumbnail lands
 * late and pushes every row below it around.
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

/** What a rail preview draws in place of the kit's static faces. */
const PREVIEW_OVERRIDES: KitComponents = {
  Question: PREVIEW_EMBED('chart'),
  Number: PREVIEW_EMBED('#'),
  DataTable: PREVIEW_EMBED('table'),
  // A player is a live cross-origin frame; a preview of one is a box.
  Video: PREVIEW_EMBED('video'),
};

function SlideRail({ slides, documentNodes, values, active, onGo, onRename, components }: {
  values: Record<string, unknown>;
  /** The static faces of the kit as loaded, with the preview stand-ins over them. */
  components: KitComponents;
  slides: DiscoveredSlide[];
  documentNodes: StoryRuntimeAppProps['nodes'];
  active: number;
  onGo: (index: number) => void;
  /** Present only while the owner is editing: renaming is the rail's one edit. */
  onRename?: (path: string, title: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const instanceKey = useId();
  const allocatePreviewIdentity = useMemo(
    () => createPreviewIdentityAllocator(documentNodes, instanceKey),
    [documentNodes, instanceKey],
  );
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
              {renderStoryNodes([slide.node], {
                values,
                components,
                decorateElement: allocatePreviewIdentity([slide.node], slide.path),
              })}
            </div>
          </span>
        </button>
      ))}
    </nav>
  );
}

function PresentBar({ active, total, onGo }: { active: number; total: number; onGo: (index: number) => void }) {
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
    <div className="mx-present" aria-label="Slide controls">
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

  return { active, go };
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
  editChildren?: (children: ReactNode[], nodes: JsxNode[], parentPath: string) => ReactNode;
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
   * Optionally import one web URL through the caller's transport
   * (lib/story-runtime/store QueryTransport.importAsset). When supplied, this
   * caller relay is authoritative for a bound `<img>` source; when absent,
   * the element loads the endpoint for itself.
   */
  importAsset?: ManagedAssetRelay;
  /**
   * Registry overrides, by component name, laid over the runtime's own — how a
   * composition that cannot run an embed (an offline file: maps, managed
   * frames) puts a same-size stand-in there instead. Pass a STABLE object: a
   * new identity rebuilds the registry and remounts every embed.
   */
  components?: Readonly<Record<string, ComponentType<Record<string, unknown>>>>;
};

const EMPTY_GLYPHS: GlyphMap = {};
const EMPTY_MERMAID_IMAGES: NonNullable<StoryIslandData['mermaidImages']> = {};

export function StoryRuntimeApp({ mentionStatuses, nodes, refData, glyphs, mermaidImages, dataflow, viewer = null, colorMode, template = null, chrome = true, assetsUrl = null, managedAssets, importAsset, store: givenStore, onMounted, editDecorate, editChildren, onSlideRename, components }: StoryRuntimeAppProps) {
  const [localStore] = useState<DataflowStore>(() => givenStore ?? createDataflowStore(dataflow ?? { flow: EMPTY_COMPILED_DATAFLOW }));
  const store = givenStore ?? localStore;
  const actions = useMemo(() => createRowActions(), [store]);
  // The kit's faces, its live faces over them, and the caller's overrides over both.
  const kit = useKit();
  const registry = useMemo(() => ({ ...kit.faces, ...kit.live, ...components }), [kit, components]);
  const previewRegistry = useMemo(() => ({ ...kit.faces, ...PREVIEW_OVERRIDES }), [kit]);
  const mountedRef = useRef(onMounted);
  mountedRef.current = onMounted;
  useEffect(() => { mountedRef.current?.(); }, []);
  // One snapshot per change (identity-stable) — the server snapshot is the
  // same object the island carried, so SSR and hydration read identical state.
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const pending = store.pending();
  /*
   * WHAT A REACTIVE EXPRESSION READS: the declared values, plus the built-in
   * markup reads. `$_me.id` is folded in HERE rather than kept in the store,
   * because it is not the document's data: the store's values are written by
   * controls, carried in the link, replaced by a new version of the document
   * and handed to the author script, and the viewer's account id is none of
   * those things (lib/story/builtins).
   */
  const signals = useMemo(() => ({ ...state.values, [VIEWER_ID]: viewer?.id ?? null }), [state.values, viewer?.id]);
  const setValue = useMemo(() => (name: string, value: Scalar, options?: { debounce?: boolean }) => store.setValue(name, value, options), [store]);

  // Discovery is a pure walk of the nodes we already hold, so the rail is
  // SERVER-rendered at its final width — no reservation guess, no shift.
  const nodeKeys = useNodeKeys(nodes);
  const slides = useMemo(() => (chrome ? discoverSlides(nodes) : []), [nodes, chrome]);
  const deck = slides.length >= MIN_SLIDES_FOR_RAIL;
  const { active, go } = useSlideChrome(deck ? slides.length : 0);
  // Sectioned reports and plans share the contents rail; captures omit it.
  const outline = useMemo(() => (chrome && !deck && (template === 'editorial' || template === 'plan') && hasOutline(nodes) ? discoverOutline(nodes) : []), [nodes, template, chrome, deck]);

  // `<img src="ref:<id>">` / `<Video poster="ref:<id>">` → the referenced
  // artifact's URL, through the SAME table the editor uses
  // (lib/story/ref-data). Without it the ref: string reaches the DOM
  // verbatim: a broken image and a CSP violation.
  const decorateElement = useMemo(() => (element: ReactElement, node: JsxElement, path: string) => {
    const patch = resolveRefProps(node, element.props as Record<string, unknown>, refData);
    const resolved = patch ? cloneElement(element as ReactElement<Record<string, unknown>>, patch) : element;
    const href=(resolved.props as Record<string,unknown>).href;
    const decorated=node.tag==='a'&&typeof href==='string'&&isPersonMentionHref(href)?<PersonMention {...resolved.props as React.AnchorHTMLAttributes<HTMLAnchorElement>}/>:resolved;
    // Edit mode wraps LAST, so it decorates the element the reader actually sees.
    return editDecorate ? editDecorate(decorated as ReactElement, node, path) : decorated;
  }, [refData, editDecorate]);

  // The URLs the browser has answered, for the life of this document. A ref,
  // not state: see RuntimeAssetContext — recording a load must not re-render.
  const seen = useRef<Set<string>>(null as unknown as Set<string>);
  if (seen.current === null) seen.current = new Set();
  const images = useMemo(()=>new Map<string,Promise<ImageAssetAnswer>>(),[state.tables,importAsset]);
  const assets = useMemo(() => ({ endpoint: assetsUrl, seen: seen.current, importAsset, images }), [assetsUrl, importAsset, images]);

  const body = (
    <PersonMentionProvider initial={mentionStatuses} artifactId={assetsUrl?.match(/\/a\/([A-Za-z0-9]+)\//)?.[1]}><RuntimeAssetContext.Provider value={assets}>
      <RuntimeEmbedContext.Provider value={{ store, flow: store.flow, state, pending, setValue, fetchPage: store.fetchPage, refData, chrome, colorMode, viewer, managedAssets, importManagedAsset: importAsset }}>
        <RowActionsContext.Provider value={actions}>{renderStoryNodes(nodes, {
          values: signals,
          tables: state.tables,
          // Identity across an adopted document: a live update re-renders this
          // tree, and positional keys would remount everything below the edit.
          keyFor: nodeKeys.keyFor,
          components: registry,
          boundControl: RuntimeBoundControl,
          boundSource: RuntimeBoundSource,
          cellControl: RuntimeCellControl,
          rowAction: RuntimeRowAction,
          decorateElement,
          decorateChildren: editChildren,
        })}</RowActionsContext.Provider>
      </RuntimeEmbedContext.Provider>
    </RuntimeAssetContext.Provider></PersonMentionProvider>
  );

  /*
   * <Icon> renders from resolved glyph DATA, so the ~1600-glyph set never ships to
   * a reader (lib/story/icon-glyphs). Provided around EVERYTHING the document
   * draws, not just its body: the deck rail re-renders each slide's own nodes to
   * make its previews, so a provider around the body alone gave every rail preview
   * the slide's text and a hole where its icon goes.
   */
  /*
   * <Mermaid> draws a diagram the server already harvested from its stored SVG
   * (lib/mermaid-images), and imports the engine only for one it has not — the
   * same whole-tree scope as the glyphs, for the same rail-preview reason.
   */
  const withGlyphs = (tree: ReactElement) => (
    <IconGlyphProvider value={glyphs ?? EMPTY_GLYPHS}><MermaidImagesProvider value={mermaidImages ?? EMPTY_MERMAID_IMAGES}>{tree}</MermaidImagesProvider></IconGlyphProvider>
  );

  if (!deck) {
    // The column wrapper on EVERY path, chrome or none: it is what the
    // authored `@container` utilities resolve against (STORY_COLUMN_CSS), so a
    // document without a rail must not be measured against something else.
    if (outline.length === 0) return withGlyphs(<div className="mx-doc">{body}</div>);
    return withGlyphs(
      <div className={template === 'plan' ? 'mx-reading mx-reading--plan' : 'mx-reading'}>
        <OutlineRail entries={outline} />
        <div className="mx-doc">{body}</div>
      </div>,
    );
  }

  return withGlyphs(
    <div className="mx-deck">
      <SlideRail slides={slides} documentNodes={nodes} values={signals} active={active} onGo={go} onRename={onSlideRename} components={previewRegistry} />
      <div className="mx-doc">{body}</div>
      <PresentBar active={active} total={slides.length} onGo={go} />
    </div>,
  );
}
