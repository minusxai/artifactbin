/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { ChevronRight } from 'lucide-solid';
import StepHeader from './StepHeader';
import type { DiscoveredTable } from '@/lib/datasets/types';

export type SourceDraft = { discovery: DiscoveredTable; included: boolean; schema: string; name: string; columns: string[]; modelCellId?: string; stale?: boolean };

function Selection(props: { label: string; selected: number; total: number; disabled: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  let input!: HTMLInputElement;
  const mixed = () => props.selected > 0 && props.selected < props.total;
  return <input ref={input} type="checkbox" aria-label={props.label} aria-checked={mixed() ? 'mixed' : props.selected > 0}
    checked={props.total > 0 && props.selected === props.total} disabled={props.disabled || props.total === 0}
    onChange={(event) => props.onChange(event.currentTarget.checked)} class="size-3.5 shrink-0 accent-accent" />;
}

/** A source's selected leaf columns define exposure; expanding a row only changes presentation. */
export function DatasetWhitelist(props: { sources: SourceDraft[]; onChange: (sources: SourceDraft[]) => void; disabled?: boolean }): JSX.Element {
  const [collapsedSchemas, setCollapsedSchemas] = createSignal<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = createSignal<Set<string>>(new Set());
  const schemas = () => [...new Set(props.sources.map((source) => source.discovery.schema))];
  const selectedColumns = (source: SourceDraft) => source.included ? source.columns : [];
  const select = (source: SourceDraft, columns: string[]) => ({ ...source, included: columns.length > 0, columns });
  const allColumns = (source: SourceDraft) => source.discovery.columns.map((column) => column.name);
  const toggle = (current: Set<string>, key: string) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; };
  const disclosure = (label: string, open: boolean, onClick: () => void) => <button type="button" aria-label={label} aria-expanded={open} onClick={onClick}
    class="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"><ChevronRight size={14} class={open ? 'rotate-90' : ''} /></button>;
  return <section aria-label="Source exposure" class="overflow-hidden rounded-xl border border-edge bg-surface">
    <StepHeader n={3} title="Whitelist">Select a schema, table, or individual columns to make them available to readers.</StepHeader>
    <div class="p-2">
      <Show when={props.sources.length === 0}><p class="px-2 py-4 text-xs text-muted">Discover database tables or run a notebook cell to choose exposed columns.</p></Show>
      <For each={schemas()}>{(schema) => {
        const entries = () => props.sources.filter((source) => source.discovery.schema === schema);
        const total = () => entries().reduce((sum, source) => sum + source.discovery.columns.length, 0);
        const selected = () => entries().reduce((sum, source) => sum + source.discovery.columns.filter((column) => selectedColumns(source).includes(column.name)).length, 0);
        const open = () => !collapsedSchemas().has(schema);
        return <div>
          <div class="flex min-h-9 items-center gap-2 rounded px-1 hover:bg-raised/50">
            {disclosure(`Toggle schema ${schema}`, open(), () => setCollapsedSchemas((value) => toggle(value, schema)))}
            <Selection label={`Expose schema ${schema}`} selected={selected()} total={total()} disabled={Boolean(props.disabled)}
              onChange={(checked) => props.onChange(props.sources.map((source) => source.discovery.schema === schema ? select(source, checked ? allColumns(source) : []) : source))} />
            <span class="min-w-0 truncate font-mono text-sm text-fg">{schema}</span>
            <span class="ml-auto shrink-0 pr-2 text-xs text-faint">{entries().filter((source) => selectedColumns(source).length > 0).length}/{entries().length} tables</span>
          </div>
          <Show when={open()}><div class="ml-4 border-l border-edge pl-2">
            <For each={props.sources}>{(source, index) => {
              const name = `${schema}.${source.discovery.name}`;
              const key = JSON.stringify([schema, source.discovery.name]);
              const columns = () => selectedColumns(source);
              const count = () => source.discovery.columns.filter((column) => columns().includes(column.name)).length;
              const expanded = () => expandedTables().has(key);
              const update = (next: string[]) => props.onChange(props.sources.map((item, i) => i === index() ? select(item, next) : item));
              return <Show when={source.discovery.schema === schema}><div>
                <div class="flex min-h-9 items-center gap-2 rounded px-1 hover:bg-raised/50">
                  {disclosure(`Toggle table ${name}`, expanded(), () => setExpandedTables((value) => toggle(value, key)))}
                  <Selection label={`Expose table ${name}`} selected={count()} total={source.discovery.columns.length} disabled={Boolean(props.disabled || source.stale)} onChange={(checked) => update(checked ? allColumns(source) : [])} />
                  <span class="min-w-0 truncate font-mono text-xs text-fg">{source.discovery.name}</span>
                  <span class="ml-auto shrink-0 pr-2 text-xs text-faint">{source.stale ? 'Run cell to update' : `${count()}/${source.discovery.columns.length} columns`}</span>
                </div>
                <Show when={expanded()}><div class="ml-4 border-l border-edge pl-2"><For each={source.discovery.columns}>{(column) => <label class="flex min-h-8 cursor-pointer items-center gap-2 rounded pl-9 pr-3 hover:bg-raised/50">
                  <input type="checkbox" aria-label={`Expose column ${name}.${column.name}`} class="size-3.5 shrink-0 accent-accent" disabled={Boolean(props.disabled || source.stale)} checked={columns().includes(column.name)} onChange={(event) => update(event.currentTarget.checked ? [...columns(), column.name] : columns().filter((candidate) => candidate !== column.name))} />
                  <span class="min-w-0 truncate font-mono text-xs text-muted">{column.name}</span><span class="ml-auto shrink-0 font-mono text-xs text-faint">{column.type}</span>
                </label>}</For></div></Show>
              </div></Show>;
            }}</For>
          </div></Show>
        </div>;
      }}</For>
    </div>
  </section>;
}
