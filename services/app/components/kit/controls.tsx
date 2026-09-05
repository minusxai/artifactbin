"use client"

/**
 * The bound-control kit: themed two-way controls over Helmet `<Value>`s —
 * `<Select>`, `<Slider>`, `<DatePicker>`, `<Segmented>`, `<Switch>` — the
 * fancy siblings of the bindable native `input`/`select`/`textarea`
 * (lib/story/dataflow.ts REF_ATTRS.components names their bound positions).
 *
 * Two faces share every pixel of chrome:
 *  - the exported component names are the STATIC face the bare registry
 *    renders (edit canvas, crawler copy, deck-rail previews): bindings are
 *    stripped from the DOM, stamped as `data-mx-bound`, and the control is
 *    disabled — right look, no pretence of working (StaticBoundControl's
 *    semantics, componentized);
 *  - the *Control primitives take RESOLVED props + onChange and are what the
 *    runtime adapters wire to the store (lib/story-runtime/StoryRuntimeApp).
 *
 * The dropdown is our own searchable listbox, portaled into its ownerDocument: the SSR string is deterministic (closed), nothing needs `useId`,
 * and it works unchanged inside the sandboxed document and the canvas's
 * nested-root iframe (outside-click listens on `ownerDocument`, never the
 * module's global — the canvas renders into another realm's document).
 */
import * as React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format as d3format } from 'd3-format';
import { refName, type TableResult } from '@/lib/story/dataflow';
import { cn } from './cn';

export interface ControlOption { value: string; label: string }

/**
 * Authored `options` → a uniform list: a `$table` reference resolves through
 * the supplied table (column 1 the value, column 2 the label when present),
 * an inline array takes strings or `{value, label}` objects.
 */
export function normalizeControlOptions(raw: unknown, table?: TableResult): ControlOption[] {
  if (typeof raw === 'string' && refName(raw)) {
    const [valueCol, labelCol] = table?.columns ?? [];
    if (!table || !valueCol) return [];
    return table.rows.map((row) => {
      const v = String(row[valueCol.name] ?? '');
      return { value: v, label: labelCol ? String(row[labelCol.name] ?? v) : v };
    });
  }
  if (Array.isArray(raw)) {
    return raw.map((o) =>
      typeof o === 'object' && o !== null
        ? { value: String((o as { value?: unknown }).value ?? ''), label: String((o as { label?: unknown }).label ?? (o as { value?: unknown }).value ?? '') }
        : { value: String(o), label: String(o) });
  }
  return [];
}

/** The `data-mx-bound` stamp: which props were `$` bindings, fixed order. */
function controlBoundStamp(props: { value?: unknown; options?: unknown; checked?: unknown }): string | undefined {
  const parts: string[] = [];
  for (const key of ['value', 'options', 'checked'] as const) {
    const name = typeof props[key] === 'string' ? refName(props[key]) : null;
    if (name) parts.push(`${key}:$${name}`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

/** A literal (non-`$`) authored scalar, or null — what a static control shows. */
const literalString = (v: unknown): string | null =>
  typeof v === 'string' && !refName(v) ? v : typeof v === 'number' ? String(v) : null;

/** Authored-prop readers, shared with the runtime adapters (StoryRuntimeApp). */
export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

interface ShellProps {
  label?: string;
  /** Right-aligned sibling of the label (the slider's live readout). */
  trailing?: React.ReactNode;
  bound?: string;
  className?: string;
  rest?: Record<string, unknown>;
  children: React.ReactNode;
}

/** The chrome every control shares: micro-label above, control below. */
function ControlShell({ label, trailing, bound, className, rest, children }: ShellProps) {
  return (
    <div {...rest} data-mx-bound={bound} className={cn('mx-control relative inline-flex flex-col gap-1.5 align-top', className)}>
      {label || trailing ? (
        <span className="flex items-baseline gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label ? <span>{label}</span> : null}
          {trailing ? <span className="ml-auto normal-case tracking-normal tabular-nums text-foreground">{trailing}</span> : null}
        </span>
      ) : null}
      {children}
    </div>
  );
}

const CHEVRON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 opacity-50" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const CHECK = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const CALENDAR = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 opacity-50" aria-hidden="true">
    <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />
  </svg>
);

// ── Select ──────────────────────────────────────────────────────────────────

export interface SelectControlProps {
  multiple?: boolean;
  allowCreate?: boolean;
  valueFormat?: 'json';
  /** Optional controlled draft, encoded using the same scalar format as value. */
  draftValue?: string | null;
  onDraftChange?: (value: string | null) => void;
  onOpenChange?: (open: boolean) => void;
  onCommit?: (value: string | null) => void;
  onCancel?: () => void;
  label?: string;
  placeholder?: string;
  className?: string;
  options: ControlOption[];
  /** Resolved current value; null = the placeholder ("all") choice. */
  value: string | null;
  /** Show the null choice (a null-default `<Value>` must be reachable). */
  nullable?: boolean;
  disabled?: boolean;
  onChange?: (value: string | null) => void;
  bound?: string;
  rest?: Record<string, unknown>;
}

const parseMultiValue = (raw: string | null | undefined): string[] | null => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) return [...new Set(parsed)];
  } catch { /* Invalid persisted values must never become an empty write. */ }
  return null;
};

export function SelectControl({ multiple = false, allowCreate = false, valueFormat, draftValue, onDraftChange, onOpenChange, onCommit, onCancel, label, placeholder = 'All', className, options, value, nullable, disabled, onChange, bound, rest }: SelectControlProps) {
  void valueFormat;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [internalDraft, setInternalDraft] = useState<string[]>(() => parseMultiValue(value) ?? []);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const draft = draftValue === undefined ? internalDraft : parseMultiValue(draftValue) ?? [];
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const invalid = multiple && (parseMultiValue(value) === null || (draftValue !== undefined && parseMultiValue(draftValue) === null));
  const inert = disabled || !onChange || invalid;
  const entries: { value: string | null; label: string }[] = [
    ...(!multiple && nullable ? [{ value: null, label: placeholder }] : []),
    ...options,
    ...(multiple ? draft.filter((item) => !options.some((option) => option.value === item)).map((item) => ({value:item, label:item})) : []),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) =>
      entry.label.toLocaleLowerCase().includes(normalizedQuery)
      || (entry.value !== null && entry.value.toLocaleLowerCase().includes(normalizedQuery)))
    : entries;
  const canCreate = multiple && allowCreate && !!query.trim() && !entries.some((entry) => entry.value === query.trim());
  const selectedValues = multiple ? parseMultiValue(value) ?? [] : [];
  const currentLabel = multiple
    ? (selectedValues.length ? selectedValues.map((item) => options.find((o) => o.value === item)?.label ?? item).join(', ') : placeholder)
    : value === null ? placeholder : options.find((o) => o.value === value)?.label ?? value;

  const updateDraft = (next: string[]) => {
    const unique = [...new Set(next)];
    draftRef.current = unique;
    if (draftValue === undefined) setInternalDraft(unique);
    onDraftChange?.(JSON.stringify(unique));
  };
  const setOpened = (next: boolean) => { openRef.current = next; setOpen(next); onOpenChange?.(next); };
  const finishClose = (restoreFocus = true) => { setOpened(false); setQuery(''); setActive(-1); if (restoreFocus) rootRef.current?.querySelector('button')?.focus(); };
  const commitDraft = (restoreFocus = true) => {
    if (inert || !openRef.current) return;
    openRef.current = false;
    const encoded = JSON.stringify(draftRef.current);
    onChange?.(encoded);
    onCommit?.(encoded);
    finishClose(restoreFocus);
  };
  const cancelDraft = () => { if (!openRef.current) return; openRef.current = false; onCancel?.(); finishClose(); };
  useEffect(() => {
    if (inert && openRef.current) setOpened(false);
  }, [inert]);

  const openList = () => {
    if (inert || open) return;
    if (multiple && draftValue === undefined) setInternalDraft(parseMultiValue(value) ?? []);
    setOpened(true);
    setQuery('');
    setActive(-1);
  };

  useEffect(() => {
    if (!open || inert) return;
    const doc = rootRef.current?.ownerDocument;
    if (!doc) return;
    searchRef.current?.focus();
    const onDown = (e: Event) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      if (multiple) commitDraft(false); else finishClose(false);
    };
    doc.addEventListener('mousedown', onDown);
    return () => doc.removeEventListener('mousedown', onDown);
  }, [open, inert, onChange, onCommit, onOpenChange]);

  const choose = (v: string | null) => {
    if (inert) return;
    if (multiple && v !== null) {
      updateDraft(draftRef.current.includes(v) ? draftRef.current.filter((item) => item !== v) : [...draftRef.current, v]);
      setQuery('');
      setActive(-1);
      searchRef.current?.focus();
      return;
    }
    onChange?.(v);
    onCommit?.(v);
    finishClose();
  };
  const createValue = (created: string) => {
    if (!draftRef.current.includes(created)) updateDraft([...draftRef.current, created]);
    setQuery('');
    setActive(-1);
  };
  const moveActive = (direction: 1 | -1) => {
    setActive((i) => Math.max(0, Math.min(filteredEntries.length + (canCreate ? 1 : 0) - 1, i + direction)));
  };
  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDraft(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && active >= 0 && filteredEntries[active]) {
      e.preventDefault();
      choose(filteredEntries[active].value);
    } else if (e.key === 'Enter' && multiple && allowCreate && query.trim()) {
      e.preventDefault();
      createValue(query.trim());
    }
  };
  const [position, setPosition] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || inert) return;
    const root = rootRef.current!;
    const win = root.ownerDocument.defaultView!;
    const place = () => {
      const rect = root.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 200), win.innerWidth - 16);
      const height = popupRef.current?.getBoundingClientRect().height ?? 0;
      setPosition({width, left: Math.max(8, Math.min(rect.left, win.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.bottom + 4, win.innerHeight - height - 8)), maxHeight: win.innerHeight - 16, overflowY:'auto'});
    };
    place();
    win.addEventListener('resize', place);
    root.ownerDocument.addEventListener('scroll', place, true);
    return () => { win.removeEventListener('resize', place); root.ownerDocument.removeEventListener('scroll', place, true); };
  }, [open, inert, query, draft.length]);
  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDraft(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
      setActive(e.key === 'ArrowDown' ? 0 : Math.max(0, entries.length - 1));
      return;
    }
    if (inert) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const normalized = e.key.toLocaleLowerCase();
      const hasMatch = entries.some((entry) =>
        entry.label.toLocaleLowerCase().includes(normalized)
        || (entry.value !== null && entry.value.toLocaleLowerCase().includes(normalized)));
      if (multiple && draftValue === undefined) setInternalDraft(parseMultiValue(value) ?? []);
      setOpened(true);
      setQuery(e.key);
      setActive(hasMatch ? 0 : -1);
    }
  };

  return (
    <ControlShell label={label} bound={bound} className={className} rest={rest}>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={inert}
          onClick={() => { if (open) multiple ? commitDraft() : finishClose(); else openList(); }}
          onKeyDown={onTriggerKeyDown}
          className="inline-flex h-9 w-full min-w-36 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn('truncate', value === null && 'text-muted-foreground')}>{currentLabel}</span>
          {CHEVRON}
        </button>
        {invalid ? <span role="alert">Expected a JSON array of strings.</span> : null}
        {open && !inert && rootRef.current ? createPortal((() => {
          const themed = rootRef.current!.closest('[data-theme], .dark, .light') as HTMLElement | null;
          return <div ref={popupRef} data-theme={themed?.dataset.theme} onBlur={(e) => {
            if (!openRef.current) return;
            const next = e.relatedTarget as Node | null;
            if (next && (popupRef.current?.contains(next) || rootRef.current?.contains(next))) return;
            if (multiple) commitDraft(false); else finishClose(false);
          }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDraft(); } }} className={cn(themed?.classList.contains('dark') && 'dark', themed?.classList.contains('light') && 'light', 'fixed z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-md')} style={position}>
            <div className="border-b border-border p-1.5">
              <input
                ref={searchRef}
                type="text"
                role="searchbox"
                aria-label={label ? `Search ${label}` : 'Search options'}
                placeholder="Type to filter…"
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  const normalized = next.trim().toLocaleLowerCase();
                  const hasMatch = entries.some((entry) =>
                    entry.label.toLocaleLowerCase().includes(normalized)
                    || (entry.value !== null && entry.value.toLocaleLowerCase().includes(normalized)));
                  setQuery(next);
                  setActive(hasMatch ? 0 : -1);
                }}
                onKeyDown={onSearchKeyDown}
                className="h-8 w-full min-w-36 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            <div role="listbox" aria-multiselectable={multiple || undefined} aria-label={label} className="max-h-56 overflow-y-auto p-1">
              {filteredEntries.map((entry, i) => {
                const selected = multiple ? entry.value !== null && draft.includes(entry.value) : entry.value === value;
                return (
                  <button
                    key={entry.value ?? '__null__'}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={entry.label}
                    onClick={() => choose(entry.value)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm',
                      i === active && 'bg-accent text-accent-foreground',
                      entry.value === null && !selected && 'text-muted-foreground',
                    )}
                  >
                    <span className="truncate">{entry.label}</span>
                    {selected ? CHECK : null}
                  </button>
                );
              })}
              {canCreate ? (
                <button type="button" role="option" aria-label={`Create ${query.trim()}`} aria-selected={false} onClick={() => createValue(query.trim())} onMouseEnter={() => setActive(filteredEntries.length)} className={cn('flex w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm', active === filteredEntries.length && 'bg-accent text-accent-foreground')}>Create “{query.trim()}”</button>
              ) : filteredEntries.length === 0 ? <div role="status" className="px-2 py-3 text-center text-sm text-muted-foreground">No matches</div> : null}
            </div>
            {multiple ? <div className="flex justify-end border-t border-border p-1.5"><button type="button" aria-label="Done" onClick={() => commitDraft()} className="rounded-sm px-2 py-1 text-sm font-medium hover:bg-accent">Done</button></div> : null}
          </div>;
        })(), rootRef.current.ownerDocument.body) : null}
      </div>
    </ControlShell>
  );
}

// ── Slider ──────────────────────────────────────────────────────────────────

export interface SliderControlProps {
  label?: string;
  className?: string;
  min: number;
  max: number;
  step?: number;
  /** d3-format spec for the readout, with optional prefix/suffix. */
  format?: string;
  prefix?: string;
  suffix?: string;
  value: number | null;
  disabled?: boolean;
  onChange?: (raw: string) => void;
  bound?: string;
  rest?: Record<string, unknown>;
}

export function SliderControl({ label, className, min, max, step, format, prefix, suffix, value, disabled, onChange, bound, rest }: SliderControlProps) {
  const inert = disabled || !onChange;
  let readout = '—';
  if (value !== null) {
    let text = String(value);
    if (format) { try { text = d3format(format)(value); } catch { /* bad spec: raw number */ } }
    readout = `${prefix ?? ''}${text}${suffix ?? ''}`;
  }
  return (
    <ControlShell label={label} trailing={readout} bound={bound} className={className} rest={rest}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        disabled={inert}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        className="h-1.5 w-44 cursor-pointer appearance-none rounded-full bg-border disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary"
      />
    </ControlShell>
  );
}

// ── DatePicker ──────────────────────────────────────────────────────────────

export interface DateControlProps {
  label?: string;
  className?: string;
  min?: string;
  max?: string;
  value: string | null;
  /** Offer the Clear choice (a null-default `<Value>` must be reachable). */
  nullable?: boolean;
  disabled?: boolean;
  onChange?: (raw: string) => void;
  bound?: string;
  rest?: Record<string, unknown>;
}

// Local date math on plain {year, month(1-12), day} triples — never Date
// arithmetic across timezones (an ISO date is a calendar day, not an instant).
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const parseISODate = (s: string | null | undefined): { y: number; m: number; d: number } | null => {
  const match = s ? ISO_DATE_RE.exec(s) : null;
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The weeks of one month as ISO dates, padded with the neighbours' days so
 * the grid is always full rows (Sunday-first, like the platform calendars).
 */
function monthGrid(y: number, m: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(y, m - 1, 1);
  const start = -first.getDay(); // days back to the leading Sunday
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  const count = Math.ceil((-start + new Date(y, m, 0).getDate()) / 7) * 7;
  for (let i = start; i < start + count; i++) {
    const date = new Date(y, m - 1, 1 + i);
    cells.push({ iso: isoOf(date.getFullYear(), date.getMonth() + 1, date.getDate()), day: date.getDate(), inMonth: date.getMonth() === m - 1 });
  }
  return cells;
}

export function DateControl({ label, className, min, max, value, nullable, disabled, onChange, bound, rest }: DateControlProps) {
  const [open, setOpen] = useState(false);
  // The month on display; (re)seeded from the value each time the calendar opens.
  const [view, setView] = useState<{ y: number; m: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inert = disabled || !onChange;

  useEffect(() => {
    if (!open) return;
    const doc = rootRef.current?.ownerDocument;
    if (!doc) return;
    const onDown = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    doc.addEventListener('mousedown', onDown);
    return () => doc.removeEventListener('mousedown', onDown);
  }, [open]);

  const today = new Date();
  const todayISO = isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const selected = parseISODate(value);
  const shown = view ?? (selected ? { y: selected.y, m: selected.m } : { y: today.getFullYear(), m: today.getMonth() + 1 });
  const outOfRange = (iso: string) => (min !== undefined && iso < min) || (max !== undefined && iso > max);
  const step = (delta: number) => {
    const next = shown.m + delta;
    setView({ y: shown.y + Math.floor((next - 1) / 12), m: ((next - 1 + 12) % 12) + 1 });
  };
  const openCalendar = () => { setView(null); setOpen((o) => !o); };
  const choose = (iso: string | null) => { onChange?.(iso ?? ''); setOpen(false); };

  return (
    <ControlShell label={label} bound={bound} className={className} rest={rest}>
      {/* The calendar is OUR popover, in the document's own tokens — the
          native <input type="date"> popup is browser chrome no CSS reaches
          (a white light-mode sheet over a nocturne dashboard). Same inline,
          portal-free pattern as SelectControl: closed in the SSR string, no
          useId, outside-click on the control's OWN document (the canvas
          renders into another realm). */}
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={inert}
          onClick={openCalendar}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          className="inline-flex h-9 w-40 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm tabular-nums shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn('truncate', value === null && 'text-muted-foreground')}>{value ?? 'Pick a date'}</span>
          {CALENDAR}
        </button>
        {open ? (
          <div role="dialog" aria-label={label ? `${label} calendar` : 'calendar'} className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
            <div className="flex items-center justify-between">
              <span className="px-1 text-sm font-medium">{MONTHS[shown.m - 1]} {shown.y}</span>
              <span className="flex items-center gap-1">
                <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                </button>
                <button type="button" aria-label="Next month" onClick={() => step(1)} className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              </span>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-y-0.5">
              {DOW.map((d, i) => (
                <span key={i} aria-hidden="true" className="flex size-8 items-center justify-center text-[11px] font-medium uppercase text-muted-foreground">{d}</span>
              ))}
              {monthGrid(shown.y, shown.m).map((cell) => {
                const isSelected = value === cell.iso;
                const dead = outOfRange(cell.iso);
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    aria-label={cell.iso}
                    aria-pressed={isSelected}
                    disabled={dead}
                    onClick={() => choose(cell.iso)}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-sm text-sm tabular-nums transition-colors',
                      isSelected ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                      !cell.inMonth && !isSelected && 'text-muted-foreground/50',
                      !isSelected && cell.iso === todayISO && 'font-semibold text-primary',
                      dead && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            {(nullable || !outOfRange(todayISO)) && (
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
                {nullable ? <button type="button" onClick={() => choose(null)} className="rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">Clear</button> : <span />}
                {!outOfRange(todayISO) && (
                  <button type="button" onClick={() => choose(todayISO)} className="rounded-sm px-1.5 py-0.5 text-primary transition-colors hover:bg-accent">Today</button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </ControlShell>
  );
}

// ── Segmented ───────────────────────────────────────────────────────────────

export interface SegmentedControlProps {
  label?: string;
  placeholder?: string;
  className?: string;
  options: ControlOption[];
  value: string | null;
  nullable?: boolean;
  disabled?: boolean;
  onChange?: (value: string | null) => void;
  bound?: string;
  rest?: Record<string, unknown>;
}

export function SegmentedControl({ label, placeholder = 'All', className, options, value, nullable, disabled, onChange, bound, rest }: SegmentedControlProps) {
  const inert = disabled || !onChange;
  const entries: { value: string | null; label: string }[] = [
    ...(nullable ? [{ value: null, label: placeholder }] : []),
    ...options,
  ];
  return (
    <ControlShell label={label} bound={bound} className={className} rest={rest}>
      <div role="group" aria-label={label} className="inline-flex w-fit items-center gap-0.5 rounded-md border border-input bg-muted/40 p-0.5 shadow-xs">
        {entries.map((entry) => {
          const on = entry.value === value;
          return (
            <button
              key={entry.value ?? '\u0000null'}
              type="button"
              aria-pressed={on}
              disabled={inert}
              onClick={onChange ? () => onChange(entry.value) : undefined}
              className={cn(
                'h-8 rounded-[5px] px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                on ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </ControlShell>
  );
}

// ── Switch ──────────────────────────────────────────────────────────────────

export interface SwitchControlProps {
  label?: string;
  className?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  bound?: string;
  rest?: Record<string, unknown>;
}

export function SwitchControl({ label, className, checked, disabled, onChange, bound, rest }: SwitchControlProps) {
  const inert = disabled || !onChange;
  return (
    <ControlShell label={label} bound={bound} className={className} rest={rest}>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={inert}
        onClick={onChange ? () => onChange(!checked) : undefined}
        className={cn(
          'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span aria-hidden="true" className={cn('block size-4 rounded-full bg-background shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </ControlShell>
  );
}

// ── The static faces the registry serves ────────────────────────────────────
//
// Authored props arrive verbatim (a binding is the literal string "$name").
// Each face strips bindings into the stamp, shows any literal value it can,
// and renders DISABLED. The runtime registry overrides these with live
// adapters (lib/story-runtime/StoryRuntimeApp).

type Authored = Record<string, unknown>;

export const shellRest = ({ label, placeholder, className, value, options, multiple, allowCreate, valueFormat, checked, min, max, step, format, prefix, suffix, disabled, children, ...rest }: Authored): Record<string, unknown> => rest;

export function Select(props: Authored) {
  return (
    <SelectControl
      label={str(props.label)}
      placeholder={str(props.placeholder)}
      className={str(props.className)}
      multiple={props.multiple === true}
      allowCreate={props.allowCreate === true}
      valueFormat={props.valueFormat === 'json' ? 'json' : undefined}
      options={normalizeControlOptions(props.options)}
      value={literalString(props.value)}
      nullable={false}
      disabled
      bound={controlBoundStamp(props)}
      rest={shellRest(props)}
    />
  );
}

export function Slider(props: Authored) {
  const min = num(props.min, 0);
  return (
    <SliderControl
      label={str(props.label)}
      className={str(props.className)}
      min={min}
      max={num(props.max, 100)}
      step={typeof props.step === 'number' ? props.step : undefined}
      format={str(props.format)}
      prefix={str(props.prefix)}
      suffix={str(props.suffix)}
      value={typeof props.value === 'number' ? props.value : null}
      disabled
      bound={controlBoundStamp(props)}
      rest={shellRest(props)}
    />
  );
}

export function DatePicker(props: Authored) {
  return (
    <DateControl
      label={str(props.label)}
      className={str(props.className)}
      min={str(props.min)}
      max={str(props.max)}
      value={literalString(props.value)}
      disabled
      bound={controlBoundStamp(props)}
      rest={shellRest(props)}
    />
  );
}

export function Segmented(props: Authored) {
  return (
    <SegmentedControl
      label={str(props.label)}
      placeholder={str(props.placeholder)}
      className={str(props.className)}
      options={normalizeControlOptions(props.options)}
      value={literalString(props.value)}
      // A bound value means the live control may offer "all"; preview that.
      nullable={typeof props.value === 'string' && refName(props.value) !== null}
      disabled
      bound={controlBoundStamp(props)}
      rest={shellRest(props)}
    />
  );
}

export function Switch(props: Authored) {
  return (
    <SwitchControl
      label={str(props.label)}
      className={str(props.className)}
      checked={props.checked === true}
      disabled
      bound={controlBoundStamp(props)}
      rest={shellRest(props)}
    />
  );
}
