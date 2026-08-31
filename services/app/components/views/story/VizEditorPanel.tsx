'use client';

/**
 * Pick a table (a <Query> or table <Value> the document declares), a chart type, and what goes on each axis.
 *
 * A `<Question>`'s data binding and visualisation are just PROPS, so this panel
 * is a lens over them: envelope in, `onChange(viz, table)` out. It holds no
 * state of its own beyond what the popover needs — the source of truth stays the
 * document, which is what makes the live preview honest rather than a copy that
 * can drift.
 *
 * Deliberately selects rather than drag-and-drop. minusx's builder drags column
 * chips into zones, which is lovely with a mouse and unusable on a phone, needs
 * a touch fallback, and would have to be restyled from Chakra. Selects say the
 * same thing, are keyboard- and screen-reader-navigable for free, and match the
 * terminal-graphite chrome. Nothing here forecloses adding drag later.
 *
 * Field lists are TYPE-AWARE: an axis that wants a measure offers numeric
 * columns first, because a quantitative encoding over a text column renders a
 * flat scale — wrong without looking wrong.
 */
import { useMemo, useState } from 'react';
import { SelectMenu } from '@/components/SelectMenu';
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
}

/**
 * The raw surface under the zone selects: the WHOLE spec as editable JSON, for
 * everything the zones don't reach — colors, scales, per-mark config.
 *
 * A draft with an explicit apply, not live parsing: half-typed JSON is invalid
 * by nature, and emitting on every keystroke would spray parse errors (or worse,
 * partial specs) into the document. The draft is keyed off the canonical JSON by
 * the parent, so an edit landing from OUTSIDE the box (a zone select, a remote
 * agent) re-seeds it rather than letting a stale draft quietly revert that
 * change on the next apply.
 */
/**
 * The Question's header strip, as a rename field. A draft committed on blur or
 * Enter — not per keystroke, which would push a document write (and a re-parse
 * of the whole body) on every letter. Keyed off the prop by the parent, so a
 * rename landing from outside re-seeds it.
 */
function TitleField({ title, onCommit }: { title: string | null; onCommit: (title: string | null) => void }) {
  const [draft, setDraft] = useState(title ?? '');
  const commit = () => {
    const next = draft.trim() ? draft : null;
    if (next !== (title ?? null)) onCommit(next);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-faint">title</span>
      <input
        type="text"
        aria-label="Chart title"
        placeholder="— no title —"
        className="w-full rounded-[4px] border border-edge bg-surface px-2 py-1 font-mono text-xs text-fg"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
    </label>
  );
}

function SpecEditor({ specJson, onApply }: { specJson: string; onApply: (parsed: Record<string, unknown>) => string | null }) {
  const [draft, setDraft] = useState(specJson);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== specJson;

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError('not valid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setError('the spec must be a JSON object');
      return;
    }
    setError(onApply(parsed as Record<string, unknown>));
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] text-faint">spec</span>
      <textarea
        aria-label="Chart spec"
        spellCheck={false}
        wrap="off"
        rows={14}
        className="w-full resize-y overflow-auto rounded-[4px] border border-edge bg-surface p-2 font-mono text-[11px] leading-[1.5] text-fg"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
      />
      {error && (
        <p className="font-sans text-[11px] text-red-500" aria-label="Chart spec error">{error}</p>
      )}
      <button
        type="button"
        aria-label="Apply chart spec"
        disabled={!dirty}
        onClick={apply}
        className="cursor-pointer self-end rounded-[4px] border border-edge px-2 py-0.5 font-mono text-[11px] text-fg hover:bg-raised disabled:cursor-default disabled:opacity-40"
      >
        update
      </button>
    </div>
  );
}

export default function VizEditorPanel({ viz, title, table, tables, onChange, onTitleChange }: VizEditorPanelProps) {
  const bound = tables.find((d) => d.name === table) ?? null;
  const columns = useMemo(() => bound?.columns ?? [], [bound]);

  // In BOTH branches below: the title is a sibling prop of `viz`, so a chart the
  // zones refuse to touch is still renameable.
  const titleField = <TitleField key={title ?? ''} title={title} onCommit={onTitleChange} />;

  // A recipe or raw-vega spec is not something these zones can safely rewrite,
  // so they stay hidden — but the raw surface still works: the whole prop is
  // shown as-is and an edit replaces it wholesale, nothing to flatten.
  //
  // EXCEPT a dynamic viz (`viz={expr}`, read as the {kind:'dynamic'} sentinel):
  // there is no value to show, and offering the sentinel in the box invites an
  // apply that writes the sentinel itself over the author's expression.
  if (!isEditableVizProp(viz)) {
    const dynamic = (viz as QuestionVizProp | undefined)?.kind === 'dynamic';
    return (
      <div className="flex flex-col gap-3" aria-label="Chart editor">
        {titleField}
        <p className="font-sans text-xs text-muted" aria-label="Chart not editable">
          {dynamic
            ? 'This chart is computed by an expression. Edit it in code mode.'
            : 'This chart is hand-written, so the pickers stay out of its way — edit the spec below directly.'}
        </p>
        {!dynamic && (
          <SpecEditor
            key={JSON.stringify(viz, null, 2)}
            specJson={JSON.stringify(viz, null, 2)}
            onApply={(parsed) => {
              if (typeof parsed.kind !== 'string') return 'the spec needs a "kind" string';
              onChange({ viz: parsed as QuestionVizProp, table });
              return null;
            }}
          />
        )}
      </div>
    );
  }

  const envelope = vizPropToEnvelope(viz);
  const spec = (envelope as { source: { spec: Record<string, unknown> } }).source.spec;
  const classified = getVizType(spec);
  // A spec with content the classifier cannot name — layered, faceted, an
  // unrecognized mark — is a chart the PICKERS must not touch: showing "table"
  // for it meant the next interaction wrote table over the author's spec. The
  // raw spec box (and the table binding) still work.
  const custom = classified == null && !isBlankSpec(spec);
  const chartType = classified ?? 'table';
  const zones = custom || chartType === 'table' ? [] : zonesForVizType(chartType as never);

  const emit = (nextEnvelope: typeof envelope, nextTable = table) =>
    onChange({ viz: envelopeToVizProp(nextEnvelope), table: nextTable });

  /** Numeric columns first for a measure zone; everything stays selectable. */
  const orderedFor = (channel: EditableChannel) => {
    const measure = channel === 'y' || channel === 'theta';
    return [...columns].sort((a, b) => {
      const an = a.type === 'number' ? 0 : 1;
      const bn = b.type === 'number' ? 0 : 1;
      return measure ? an - bn : bn - an;
    });
  };

  return (
    <div className="flex flex-col gap-3" aria-label="Chart editor">
      {titleField}
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] text-faint">data</span>
        <SelectMenu
          ariaLabel="Table"
          value={table ?? ''}
          onChange={(v) => emit(envelope, v || null)}
          options={[
            { value: '', label: '— pick a table —' },
            ...tables.map((d) => ({ value: d.name, label: `$${d.name}` })),
            /* The document points at something it does not declare. Showing
               the placeholder instead would claim the chart is unbound — and the
               next edit would write that claim into the source. */
            ...(table && !bound ? [{ value: table, label: `$${table} (not declared)` }] : []),
          ]}
        />
      </div>
      {table && !bound && (
        <p className="font-sans text-[11px] text-amber-600" aria-label="Missing table notice">
          This chart points at a table the document does not declare — add a &lt;Query&gt; or &lt;Value&gt; in &lt;Helmet&gt;.
        </p>
      )}

      {custom ? (
        <p className="font-sans text-xs text-muted" aria-label="Custom chart notice">
          This chart&apos;s spec is more than the pickers can describe, so they stay out of
          its way — edit the spec below directly.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-faint">chart</span>
          <SelectMenu
            ariaLabel="Chart type"
            value={chartType}
            onChange={(type) => {
              // "table" is the absence of a chart, not a chart type: clearing the
              // spec is what makes <Question> fall back to the themed table.
              emit(type === 'table' ? vizPropToEnvelope(undefined) : setVizType(envelope, type as never));
            }}
            options={CHART_TYPES.map((t) => ({ value: t, label: t }))}
          />
        </div>
      )}

      {zones.map((zone) => {
        const current = getChannelField(spec, zone.channel) ?? '';
        return (
          <div key={zone.channel} className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-faint">{zone.label.toLowerCase()}</span>
            <SelectMenu
              ariaLabel={zone.label}
              value={current}
              disabled={columns.length === 0}
              onChange={(name) => {
                const col = columns.find((c) => c.name === name);
                emit(setChannelField(envelope, zone.channel, name ? vizColumn(name, col?.type) : null));
              }}
              options={[
                { value: '', label: '— none —' },
                ...orderedFor(zone.channel).map((c) => ({ value: c.name, label: c.name, hint: c.type })),
              ]}
            />
          </div>
        );
      })}

      {chartType !== 'table' && columns.length === 0 && (
        <p className="font-sans text-[11px] text-muted" aria-label="No table notice">
          Pick a table to choose fields.
        </p>
      )}

      {/* Keyed by the canonical JSON: a zone select (or a remote edit) that
          rewrites the spec re-seeds the draft, while local typing does not. */}
      <SpecEditor
        key={JSON.stringify(spec, null, 2)}
        specJson={JSON.stringify(spec, null, 2)}
        onApply={(parsed) => {
          // Through the same envelope door as the zones, so an emptied spec
          // clears the viz back to a table instead of drawing an empty frame.
          emit({ ...envelope, source: { kind: 'vega-lite', spec: parsed } } as typeof envelope);
          return null;
        }}
      />
    </div>
  );
}
