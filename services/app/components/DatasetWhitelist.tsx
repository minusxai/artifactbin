import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DiscoveredTable } from '@/lib/datasets/types';

export type SourceDraft = { discovery: DiscoveredTable; included: boolean; schema: string; name: string; columns: string[]; modelCellId?: string; stale?: boolean };

function Selection({ label, selected, total, disabled, onChange }: { label: string; selected: number; total: number; disabled: boolean; onChange: (checked: boolean) => void }) {
  const mixed = selected > 0 && selected < total;
  return <input type="checkbox" aria-label={label} aria-checked={mixed ? 'mixed' : selected > 0} checked={total > 0 && selected === total} ref={node => { if (node) node.indeterminate = mixed; }} disabled={disabled || total === 0} onChange={e => onChange(e.target.checked)} className="size-3.5 shrink-0 accent-accent" />;
}

/** Expansion is presentation only; the selected leaf columns define exposure. */
export function DatasetWhitelist({ sources, onChange, disabled = false }: { sources: SourceDraft[]; onChange: (sources: SourceDraft[]) => void; disabled?: boolean }) {
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const schemas = [...new Set(sources.map(s => s.discovery.schema))];
  const selectedColumns = (source: SourceDraft) => source.included ? source.columns : [];
  const select = (source: SourceDraft, columns: string[]) => ({ ...source, included: columns.length > 0, columns });
  const allColumns = (source: SourceDraft) => source.discovery.columns.map(c => c.name);
  const toggle = (current: Set<string>, key: string) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; };
  const disclosure = (label: string, open: boolean, onClick: () => void) => <button type="button" aria-label={label} aria-expanded={open} onClick={onClick} className="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"><ChevronRight size={14} className={open ? 'rotate-90' : ''} /></button>;

  return <section aria-label="Source exposure" className="overflow-hidden rounded border border-edge bg-surface">
    <header className="border-b border-edge px-4 py-3"><h2 className="text-sm font-medium text-fg">3. Whitelist</h2><p className="mt-1 text-xs text-muted">Select a schema, table, or individual columns to make them available.</p></header>
    <div className="p-2">
      {!sources.length && <p className="px-2 py-4 text-xs text-muted">Discover database tables or run a notebook cell to choose exposed columns.</p>}
      {schemas.map(schema => {
        const entries = sources.filter(s => s.discovery.schema === schema);
        const total = entries.reduce((sum, s) => sum + s.discovery.columns.length, 0);
        const selected = entries.reduce((sum, s) => sum + s.discovery.columns.filter(c => selectedColumns(s).includes(c.name)).length, 0);
        const open = !collapsedSchemas.has(schema);
        return <div key={schema}>
          <div className="flex min-h-9 items-center gap-2 rounded px-1 hover:bg-raised/50">
            {disclosure(`Toggle schema ${schema}`, open, () => setCollapsedSchemas(value => toggle(value, schema)))}
            <Selection label={`Expose schema ${schema}`} selected={selected} total={total} disabled={disabled} onChange={checked => onChange(sources.map(s => s.discovery.schema === schema ? select(s, checked ? allColumns(s) : []) : s))} />
            <span className="min-w-0 truncate font-mono text-sm text-fg">{schema}</span><span className="ml-auto shrink-0 pr-2 text-xs text-faint">{entries.filter(s => selectedColumns(s).length > 0).length}/{entries.length} tables</span>
          </div>
          {open && <div className="ml-4 border-l border-edge pl-2">
            {sources.map((source, index) => {
              if (source.discovery.schema !== schema) return null;
              const name = `${schema}.${source.discovery.name}`;
              const key = JSON.stringify([schema, source.discovery.name]);
              const columns = selectedColumns(source);
              const count = source.discovery.columns.filter(c => columns.includes(c.name)).length;
              const expanded = expandedTables.has(key);
              const update = (next: string[]) => onChange(sources.map((s, i) => i === index ? select(s, next) : s));
              return <div key={key}>
                <div className="flex min-h-9 items-center gap-2 rounded px-1 hover:bg-raised/50">
                  {disclosure(`Toggle table ${name}`, expanded, () => setExpandedTables(value => toggle(value, key)))}
                  <Selection label={`Expose table ${name}`} selected={count} total={source.discovery.columns.length} disabled={disabled || Boolean(source.stale)} onChange={checked => update(checked ? allColumns(source) : [])} />
                  <span className="min-w-0 truncate font-mono text-xs text-fg">{source.discovery.name}</span><span className="ml-auto shrink-0 pr-2 text-xs text-faint">{source.stale ? 'Run cell to update' : `${count}/${source.discovery.columns.length} columns`}</span>
                </div>
                {expanded && <div className="ml-4 border-l border-edge pl-2">
                  {source.discovery.columns.map(column => <label key={column.name} className="flex min-h-8 cursor-pointer items-center gap-2 rounded pl-9 pr-3 hover:bg-raised/50">
                    <input type="checkbox" aria-label={`Expose column ${name}.${column.name}`} className="size-3.5 shrink-0 accent-accent" disabled={disabled || Boolean(source.stale)} checked={columns.includes(column.name)} onChange={e => update(e.target.checked ? [...columns, column.name] : columns.filter(c => c !== column.name))} />
                    <span className="min-w-0 truncate font-mono text-xs text-muted">{column.name}</span><span className="ml-auto shrink-0 font-mono text-xs text-faint">{column.type}</span>
                  </label>)}
                </div>}
              </div>;
            })}
          </div>}
        </div>;
      })}
    </div>
  </section>;
}
