/* @jsxImportSource solid-js */
/**
 *
 *
 * Pick a table (a <Query> or table <Value> the document declares), a chart type, and what goes on each axis.
 *
 * A `<Question>`'s data binding and visualisation are just PROPS, so this panel
 * is a lens over them: envelope in, `onChange(viz, table)` out. It holds no
 * state of its own beyond what the popover needs — the source of truth stays the
 * document, which is what makes the live preview honest rather than a copy that
 * can drift.
 *
 * Deliberately selects rather than drag-and-drop. Dragging column chips into
 * zones is lovely with a mouse, unusable on a phone and needs a touch fallback.
 * Selects say the same thing, are keyboard- and screen-reader-navigable for
 * free, and match the terminal-graphite chrome.
 *
 * Field lists are TYPE-AWARE: an axis that wants a measure offers numeric
 * columns first, because a quantitative encoding over a text column renders a
 * flat scale — wrong without looking wrong.
 */
import { createEffect, createSignal, For, on, Show, type JSX } from 'solid-js';
import { SelectMenu } from '@/solid/components/SelectMenu';
import BoundQuery from '../BoundQuery';
import type { TableChoice } from '@/lib/story/table-catalog';
import {
  getChannelField, setChannelField, getVizType, setVizType, zonesForVizType, isBlankSpec,
  type EditableChannel,
} from '@/lib/viz/encoding-edit';
import {
  vizPropToEnvelope, envelopeToVizProp, vizColumn, isEditableVizProp,
  type QuestionVizProp,
} from '@/lib/viz/question-envelope';

/** Chart types the panel offers. A subset of what the engine renders — the ones
 *  that need only the x/y/color zones this UI exposes. */
const CHART_TYPES = ['table', 'bar', 'line', 'area', 'scatter', 'pie'] as const;

export interface VizEditorPanelProps {
  /** The Question's current `viz` prop (undefined = renders a table). */
  viz: unknown;
  /** The Question's `title` prop — the header strip above the chart. */
  title: string | null;
  /** The declared table it is bound to (`data="$name"` → "name"), if any. */
  table: string | null;
  /**
   * The tables the document declares (lib/story/table-catalog.ts). A query's
   * columns are known once it has run; until then its entry lists none, and
   * the field pickers stay empty rather than wrong.
   */
  tables: TableChoice[];
  onChange: (next: { viz: QuestionVizProp | undefined; table: string | null }) => void;
  /**
   * A rename, on its own channel: the title is a sibling prop, not part of the
   * viz, and routing it through `onChange` would force a rewrite of a `viz` the
   * panel may not even be able to read (a dynamic expression). `null` = remove.
   */
  onTitleChange: (title: string | null) => void;
  /**
   * Open the named query in the notebook rail (InPlaceEditor). Absent where
   * there is no rail to open — the inspector then shows the SQL and no opener.
   */
  onOpenQuery?: (name: string) => void;
}

/**
 * The Question's header strip, as a rename field. A draft committed on blur or
 * Enter — not per keystroke, which would push a document write (and a re-parse
 * of the whole body) on every letter. Re-seeded whenever `title` changes from
 * OUTSIDE this field (mirrors the React panel's `key={title}` remount).
 */
function TitleField(props: { title: string | null; onCommit: (title: string | null) => void }): JSX.Element {
  const [draft, setDraft] = createSignal(props.title ?? '');
  createEffect(on(() => props.title, (t) => setDraft(t ?? ''), { defer: true }));
  const commit = () => {
    const next = draft().trim() ? draft() : null;
    if (next !== (props.title ?? null)) props.onCommit(next);
  };
  return (
    <label class="flex flex-col gap-1">
      <span class="font-mono text-[11px] text-faint">title</span>
      <input
        type="text"
        aria-label="Chart title"
        placeholder="— no title —"
        class="w-full rounded-[4px] border border-edge bg-surface px-2 py-1 font-mono text-xs text-fg"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

/**
 * The raw surface under the zone selects: the WHOLE spec as editable JSON, for
 * everything the zones don't reach — colors, scales, per-mark config.
 *
 * A draft with an explicit apply, not live parsing: half-typed JSON is invalid
 * by nature, and emitting on every keystroke would spray parse errors (or worse,
 * partial specs) into the document. Re-seeded whenever `specJson` changes from
 * OUTSIDE this box (a zone select, a remote agent) — mirrors the React panel's
 * `key={specJson}` remount, so a stale draft never quietly reverts that change
 * on the next apply.
 */
function SpecEditor(props: { specJson: string; onApply: (parsed: Record<string, unknown>) => string | null }): JSX.Element {
  const [draft, setDraft] = createSignal(props.specJson);
  const [error, setError] = createSignal<string | null>(null);
  createEffect(on(() => props.specJson, (v) => { setDraft(v); setError(null); }, { defer: true }));
  const dirty = () => draft() !== props.specJson;

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft());
    } catch {
      setError('not valid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setError('the spec must be a JSON object');
      return;
    }
    setError(props.onApply(parsed as Record<string, unknown>));
  };

  return (
    <div class="flex flex-col gap-1">
      <span class="font-mono text-[11px] text-faint">spec</span>
      <textarea
        aria-label="Chart spec"
        spellcheck={false}
        wrap="off"
        rows={14}
        class="w-full resize-y overflow-auto rounded-[4px] border border-edge bg-surface p-2 font-mono text-[11px] leading-[1.5] text-fg"
        value={draft()}
        onInput={(e) => { setDraft(e.currentTarget.value); setError(null); }}
      />
      <Show when={error()}>
        {(msg) => <p class="font-sans text-[11px] text-red-500" aria-label="Chart spec error">{msg()}</p>}
      </Show>
      <button
        type="button"
        aria-label="Apply chart spec"
        disabled={!dirty()}
        onClick={apply}
        class="cursor-pointer self-end rounded-[4px] border border-edge px-2 py-0.5 font-mono text-[11px] text-fg hover:bg-raised disabled:cursor-default disabled:opacity-40"
      >
        update
      </button>
    </div>
  );
}

export default function VizEditorPanel(props: VizEditorPanelProps): JSX.Element {
  const bound = () => props.tables.find((d) => d.name === props.table) ?? null;
  const columns = () => bound()?.columns ?? [];
  // A recipe or raw-vega spec is not something the zones can safely rewrite; a
  // dynamic viz (`viz={expr}`, read as the {kind:'dynamic'} sentinel) has no
  // value to show at all.
  const editable = () => isEditableVizProp(props.viz);
  const dynamic = () => (props.viz as QuestionVizProp | undefined)?.kind === 'dynamic';

  const envelope = () => vizPropToEnvelope(props.viz as QuestionVizProp | undefined);
  const spec = () => (envelope() as { source: { spec: Record<string, unknown> } }).source.spec;
  const classified = () => getVizType(spec());
  // A spec with content the classifier cannot name — layered, faceted, an
  // unrecognized mark — is a chart the PICKERS must not touch: showing "table"
  // for it means the next interaction would write table over the author's spec.
  const custom = () => classified() == null && !isBlankSpec(spec());
  const chartType = () => classified() ?? 'table';
  const zones = () => (custom() || chartType() === 'table' ? [] : zonesForVizType(chartType() as never));

  const emit = (nextEnvelope: ReturnType<typeof envelope>, nextTable = props.table) =>
    props.onChange({ viz: envelopeToVizProp(nextEnvelope), table: nextTable });

  /** Numeric columns first for a measure zone; everything stays selectable. */
  const orderedFor = (channel: EditableChannel) => {
    const measure = channel === 'y' || channel === 'theta';
    return [...columns()].sort((a, b) => {
      const an = a.type === 'number' ? 0 : 1;
      const bn = b.type === 'number' ? 0 : 1;
      return measure ? an - bn : bn - an;
    });
  };

  return (
    <Show
      when={editable()}
      fallback={
        <div class="flex flex-col gap-3" aria-label="Chart editor">
          <TitleField title={props.title} onCommit={props.onTitleChange} />
          {/* The binding is a sibling prop the zones never touch, so a recipe (a
              trend tile, a funnel) still says what it reads and shows the query
              behind it — read-only here; the spec box below owns the rewrite. */}
          <Show when={props.table}>
            <div class="flex flex-col gap-1">
              <span class="font-mono text-[11px] text-faint">data</span>
              <span aria-label="Table" class="font-mono text-xs text-fg">${props.table}</span>
            </div>
          </Show>
          <BoundQuery table={bound()} onOpenQuery={props.onOpenQuery} />
          <p class="font-sans text-xs text-muted" aria-label="Chart not editable">
            {dynamic()
              ? 'This chart is computed by an expression. Edit it in code mode.'
              : 'This chart is hand-written, so the pickers stay out of its way — edit the spec below directly.'}
          </p>
          <Show when={!dynamic()}>
            <SpecEditor
              specJson={JSON.stringify(props.viz, null, 2)}
              onApply={(parsed) => {
                if (typeof parsed.kind !== 'string') return 'the spec needs a "kind" string';
                props.onChange({ viz: parsed as QuestionVizProp, table: props.table });
                return null;
              }}
            />
          </Show>
        </div>
      }
    >
      <div class="flex flex-col gap-3" aria-label="Chart editor">
        <TitleField title={props.title} onCommit={props.onTitleChange} />
        <div class="flex flex-col gap-1">
          <span class="font-mono text-[11px] text-faint">data</span>
          <SelectMenu
            ariaLabel="Table"
            value={props.table ?? ''}
            onChange={(v) => emit(envelope(), v || null)}
            options={[
              { value: '', label: '— pick a table —' },
              ...props.tables.map((d) => ({ value: d.name, label: `$${d.name}` })),
              /* The document points at something it does not declare. Showing
                 the placeholder instead would claim the chart is unbound — and the
                 next edit would write that claim into the source. */
              ...(props.table && !bound() ? [{ value: props.table, label: `$${props.table} (not declared)` }] : []),
            ]}
          />
        </div>
        <BoundQuery table={bound()} onOpenQuery={props.onOpenQuery} />
        <Show when={props.table && !bound()}>
          <p class="font-sans text-[11px] text-amber-600" aria-label="Missing table notice">
            This chart points at a table the document does not declare — add a &lt;Query&gt; or &lt;Value&gt; in &lt;Helmet&gt;.
          </p>
        </Show>

        <Show
          when={custom()}
          fallback={
            <div class="flex flex-col gap-1">
              <span class="font-mono text-[11px] text-faint">chart</span>
              <SelectMenu
                ariaLabel="Chart type"
                value={chartType()}
                onChange={(type) => {
                  // "table" is the absence of a chart, not a chart type: clearing the
                  // spec is what makes <Question> fall back to the themed table.
                  emit(type === 'table' ? vizPropToEnvelope(undefined) : setVizType(envelope(), type as never));
                }}
                options={CHART_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </div>
          }
        >
          <p class="font-sans text-xs text-muted" aria-label="Custom chart notice">
            This chart&apos;s spec is more than the pickers can describe, so they stay out of
            its way — edit the spec below directly.
          </p>
        </Show>

        <For each={zones()}>
          {(zone) => {
            const current = () => getChannelField(spec(), zone.channel) ?? '';
            return (
              <div class="flex flex-col gap-1">
                <span class="font-mono text-[11px] text-faint">{zone.label.toLowerCase()}</span>
                <SelectMenu
                  ariaLabel={zone.label}
                  value={current()}
                  disabled={columns().length === 0}
                  onChange={(name) => {
                    const col = columns().find((c) => c.name === name);
                    emit(setChannelField(envelope(), zone.channel, name ? vizColumn(name, col?.type) : null));
                  }}
                  options={[
                    { value: '', label: '— none —' },
                    ...orderedFor(zone.channel).map((c) => ({ value: c.name, label: c.name, hint: c.type })),
                  ]}
                />
              </div>
            );
          }}
        </For>

        <Show when={chartType() !== 'table' && columns().length === 0}>
          <p class="font-sans text-[11px] text-muted" aria-label="No table notice">
            Pick a table to choose fields.
          </p>
        </Show>

        {/* Re-seeds whenever a zone select (or a remote edit) rewrites the spec;
            local typing does not, until Apply. */}
        <SpecEditor
          specJson={JSON.stringify(spec(), null, 2)}
          onApply={(parsed) => {
            // Through the same envelope door as the zones, so an emptied spec
            // clears the viz back to a table instead of drawing an empty frame.
            emit({ ...envelope(), source: { kind: 'vega-lite', spec: parsed } } as ReturnType<typeof envelope>);
            return null;
          }}
        />
      </div>
    </Show>
  );
}
