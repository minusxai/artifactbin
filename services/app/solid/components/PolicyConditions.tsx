/* @jsxImportSource solid-js */
import { For, Show, type JSX } from 'solid-js';
import type { PolicyPredicate } from '@artifactbin/contracts';

type Column = { name: string; type?: string };
const operators: Record<string, string> = { _eq: 'equals', _neq: 'does not equal', _gt: 'greater than', _gte: 'at least', _lt: 'less than', _lte: 'at most', _in: 'is one of', _nin: 'is not one of', _is_null: 'is null' };
const without = (value: PolicyPredicate, key: string): PolicyPredicate => Object.fromEntries(Object.entries(value).filter(([field]) => field !== key)) as PolicyPredicate;
const condition = (columns: Column[]): PolicyPredicate => ({ [columns[0]?.name ?? 'column']: { _eq: '' } });
const parse = (value: string): unknown => { try { return JSON.parse(value); } catch { return value; } };
const fieldClass = 'min-w-0 w-full rounded border border-edge bg-surface px-2 py-1.5 text-xs text-fg';

/** Structured policy predicates preserve boolean groups and sibling expressions. */
export function PolicyConditions(props: { label: string; title: string; value: PolicyPredicate; columns: Column[]; onChange: (value: PolicyPredicate) => void }): JSX.Element {
  const append = (next: PolicyPredicate) => {
    const value = props.value;
    if (Object.keys(value).length === 1 && Array.isArray(value._and)) props.onChange({ _and: [...value._and, next] });
    else props.onChange({ _and: [...(Object.keys(value).length ? [value] : []), next] });
  };
  return <fieldset class="min-w-0 space-y-3"><legend class="mb-2 text-sm font-medium text-fg">{props.title}</legend>
    <Show when={Object.keys(props.value).length} fallback={<p class="rounded bg-raised/40 px-3 py-3 text-xs text-muted">No conditions. All rows are allowed.</p>}><Predicate label={props.label} value={props.value} columns={props.columns} onChange={props.onChange} /></Show>
    <div class="flex flex-wrap gap-1"><button type="button" aria-label={`Add ${props.label} condition`} onClick={() => append(condition(props.columns))} class="rounded px-2 py-1 text-xs text-muted hover:bg-raised">+ Add condition</button><button type="button" aria-label={`Add ${props.label} group`} onClick={() => append({ _or: [condition(props.columns)] })} class="rounded px-2 py-1 text-xs text-muted hover:bg-raised">+ Add group</button><Show when={Object.keys(props.value).length}><button type="button" aria-label={`Clear ${props.label}`} onClick={() => props.onChange({})}>Clear all</button></Show></div>
  </fieldset>;
}

function Predicate(props: { label: string; value: PolicyPredicate; columns: Column[]; onChange: (value: PolicyPredicate) => void }): JSX.Element {
  const entries = () => Object.entries(props.value);
  return <div class="min-w-0 space-y-2"><For each={entries()}>{([field, expression]) => {
    if (field === '_and' || field === '_or' || field === '_not') {
      const children = () => field === '_not' ? [expression as PolicyPredicate] : expression as PolicyPredicate[];
      return <div class="min-w-0 rounded border border-edge bg-raised/20 p-3"><label class="mb-2 flex items-center gap-2 text-xs">Match<select aria-label={`${props.label} match`} value={field} onChange={event => { const mode = event.currentTarget.value; props.onChange({ ...without(props.value, field), [mode]: mode === '_not' ? children().length === 1 ? children()[0] : { _and: children() } : children() } as PolicyPredicate); }} class={fieldClass}><option value="_and">All conditions</option><option value="_or">Any condition</option><option value="_not">Not this group</option></select></label>
        <For each={children()}>{(child, index) => <div class="mt-2 flex min-w-0 items-start gap-1"><div class="min-w-0 flex-1"><Predicate label={`${props.label}.${index() + 1}`} value={child} columns={props.columns} onChange={next => props.onChange({ ...props.value, [field]: field === '_not' ? next : Object.keys(next).length ? children().map((prior, i) => i === index() ? next : prior) : children().filter((_, i) => i !== index()) } as PolicyPredicate)} /></div><button type="button" aria-label={`Remove ${props.label}.${index() + 1} group`} onClick={() => props.onChange(field === '_not' ? without(props.value, field) : { ...props.value, [field]: children().filter((_, i) => i !== index()) } as PolicyPredicate)}>×</button></div>}</For>
        <Show when={field !== '_not'}><div class="mt-2 flex gap-2"><button type="button" aria-label={`Add ${props.label} group condition`} onClick={() => props.onChange({ ...props.value, [field]: [...children(), condition(props.columns)] } as PolicyPredicate)}>+ Condition</button><button type="button" aria-label={`Add ${props.label} nested group`} onClick={() => props.onChange({ ...props.value, [field]: [...children(), { _and: [] }] } as PolicyPredicate)}>+ Group</button></div></Show>
      </div>;
    }
    const pairs = () => Object.entries(expression as Record<string, unknown>);
    return <For each={pairs()}>{([operator, constant], index) => {
      const label = () => `${props.label}.${index() + 1}`;
      const set = (nextField: string, nextOperator: string, nextValue: unknown) => {
        const remaining = without(expression as PolicyPredicate, operator);
        const siblings = Object.keys(remaining).length ? { ...props.value, [field]: remaining } : without(props.value, field);
        const prior = siblings[nextField] as Record<string, unknown> | undefined;
        if (Object.hasOwn(prior ?? {}, nextOperator)) props.onChange({ _and: [siblings, { [nextField]: { [nextOperator]: nextValue } }] });
        else props.onChange({ ...siblings, [nextField]: { ...(prior ?? {}), [nextOperator]: nextValue } } as PolicyPredicate);
      };
      return <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1 rounded border border-edge bg-surface p-2"><div class="grid min-w-0 gap-2 sm:grid-cols-[1fr_1fr_1.2fr]"><select aria-label={`${label()} column`} value={field} onChange={event => set(event.currentTarget.value, operator, constant)} class={fieldClass}>{[...new Set([field, ...props.columns.map(column => column.name)])].map(name => <option selected={name === field}>{name}</option>)}</select><select aria-label={`${label()} operator`} value={operator} onChange={event => set(field, event.currentTarget.value, event.currentTarget.value === '_is_null' ? true : constant)} class={fieldClass}>{Object.entries(operators).map(([name, text]) => <option value={name} selected={name === operator}>{text}</option>)}</select><input aria-label={`${label()} value`} value={typeof constant === 'string' ? JSON.stringify(constant) : JSON.stringify(constant) ?? ''} onInput={event => set(field, operator, parse(event.currentTarget.value))} class={fieldClass} /></div><button type="button" aria-label={`Remove ${label()} condition`} onClick={() => { const remaining = without(expression as PolicyPredicate, operator); props.onChange(Object.keys(remaining).length ? { ...props.value, [field]: remaining } as PolicyPredicate : without(props.value, field)); }} class="px-2">×</button></div>;
    }}</For>;
  }}</For></div>;
}
