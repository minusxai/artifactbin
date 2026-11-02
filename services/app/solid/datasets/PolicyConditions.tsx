/* @jsxImportSource solid-js */
import { For, Show, type JSX } from 'solid-js';
import X from 'lucide-solid/icons/x';
import type { PolicyPredicate } from '@artifactbin/contracts';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { Select } from '../ui/Select';

type Column = { name: string; type?: string };
/** Every operator the dataset predicate grammar accepts (contracts DATASET_COLUMN_OPERATORS), in words. */
const operators: Record<string, string> = { _eq: 'equals', _neq: 'does not equal', _gt: 'greater than', _gte: 'at least', _lt: 'less than', _lte: 'at most', _in: 'is one of', _nin: 'is not one of', _is_null: 'is null', _like: 'matches (like)', _nlike: 'does not match (like)', _ilike: 'matches, any case (ilike)', _nilike: 'does not match, any case (nilike)' };
const operatorOptions = Object.entries(operators).map(([value, label]) => ({ value, label }));
/** A comparison value may be the requester's session value instead of a constant (matched case-insensitively). */
const SESSION_VALUES = [{ value: 'X-Hasura-User-Id', label: 'Current user ID' }, { value: 'X-Hasura-Page-Id', label: 'Current page ID' }];
const sourceOptions = [{ value: 'fixed', label: 'Fixed value' }, ...SESSION_VALUES];
const sessionValue = (value: unknown): string | null => typeof value === 'string' ? SESSION_VALUES.find(option => option.value.toLowerCase() === value.toLowerCase())?.value ?? null : null;
const matchOptions = [{ value: '_and', label: 'All conditions' }, { value: '_or', label: 'Any condition' }, { value: '_not', label: 'Not this group' }];
const without = (value: PolicyPredicate, key: string): PolicyPredicate => Object.fromEntries(Object.entries(value).filter(([field]) => field !== key)) as PolicyPredicate;
const condition = (columns: Column[]): PolicyPredicate => ({ [columns[0]?.name ?? 'column']: { _eq: '' } });
const parse = (value: string): unknown => { try { return JSON.parse(value); } catch { return value; } };

/** Structured policy predicates preserve boolean groups and sibling expressions. */
export function PolicyConditions(props: { label: string; title: string; value: PolicyPredicate; columns: Column[]; onChange: (value: PolicyPredicate) => void }): JSX.Element {
  const append = (next: PolicyPredicate) => {
    const value = props.value;
    if (Object.keys(value).length === 1 && Array.isArray(value._and)) props.onChange({ _and: [...value._and, next] });
    else props.onChange({ _and: [...(Object.keys(value).length ? [value] : []), next] });
  };
  return <fieldset class="min-w-0 space-y-3"><legend class="mb-2 text-sm font-medium text-fg">{props.title}</legend>
    <Show when={Object.keys(props.value).length} fallback={<p class="rounded-control bg-raised/40 px-3 py-3 text-xs text-muted">No conditions. All rows are allowed.</p>}><Predicate label={props.label} value={props.value} columns={props.columns} onChange={props.onChange} /></Show>
    <div class="flex flex-wrap gap-1">
      <Button type="button" variant="ghost" size="sm" aria-label={`Add ${props.label} condition`} onClick={() => append(condition(props.columns))}>+ Add condition</Button>
      <Button type="button" variant="ghost" size="sm" aria-label={`Add ${props.label} group`} onClick={() => append({ _or: [condition(props.columns)] })}>+ Add group</Button>
      <Show when={Object.keys(props.value).length}><Button type="button" variant="ghost" size="sm" aria-label={`Clear ${props.label}`} onClick={() => props.onChange({})}>Clear all</Button></Show>
    </div>
  </fieldset>;
}

function Predicate(props: { label: string; value: PolicyPredicate; columns: Column[]; onChange: (value: PolicyPredicate) => void }): JSX.Element {
  const entries = () => Object.entries(props.value);
  return <div class="min-w-0 space-y-2"><For each={entries()}>{([field, expression]) => {
    if (field === '_and' || field === '_or' || field === '_not') {
      const children = () => field === '_not' ? [expression as PolicyPredicate] : expression as PolicyPredicate[];
      return <Panel padding="sm"><div class="mb-2 flex items-center gap-2 text-xs"><span>Match</span>
        <Select size="sm" class="w-44" ariaLabel={`${props.label} match`} value={field} options={matchOptions} onChange={mode => props.onChange({ ...without(props.value, field), [mode]: mode === '_not' ? children().length === 1 ? children()[0] : { _and: children() } : children() } as PolicyPredicate)} /></div>
        <For each={children()}>{(child, index) => <div class="mt-2 flex min-w-0 items-start gap-1"><div class="min-w-0 flex-1"><Predicate label={`${props.label}.${index() + 1}`} value={child} columns={props.columns} onChange={next => props.onChange({ ...props.value, [field]: field === '_not' ? next : Object.keys(next).length ? children().map((prior, i) => i === index() ? next : prior) : children().filter((_, i) => i !== index()) } as PolicyPredicate)} /></div>
          <Button type="button" variant="ghost" size="sm" icon aria-label={`Remove ${props.label}.${index() + 1} group`} onClick={() => props.onChange(field === '_not' ? without(props.value, field) : { ...props.value, [field]: children().filter((_, i) => i !== index()) } as PolicyPredicate)}><X size={13} aria-hidden="true" /></Button></div>}</For>
        <Show when={field !== '_not'}><div class="mt-2 flex gap-2">
          <Button type="button" variant="ghost" size="sm" aria-label={`Add ${props.label} group condition`} onClick={() => props.onChange({ ...props.value, [field]: [...children(), condition(props.columns)] } as PolicyPredicate)}>+ Condition</Button>
          <Button type="button" variant="ghost" size="sm" aria-label={`Add ${props.label} nested group`} onClick={() => props.onChange({ ...props.value, [field]: [...children(), { _and: [] }] } as PolicyPredicate)}>+ Group</Button>
        </div></Show>
      </Panel>;
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
      const columnOptions = () => [...new Set([field, ...props.columns.map(column => column.name), '_id'])].map(name => ({ value: name, label: name === '_id' ? '_id (row ID)' : name }));
      return <Panel padding="none" class="grid grid-cols-[minmax(0,1fr)_auto] gap-1 p-2"><div class="grid min-w-0 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.2fr]">
        <Select size="sm" ariaLabel={`${label()} column`} value={field} options={columnOptions()} onChange={name => set(name, operator, constant)} />
        <Select size="sm" ariaLabel={`${label()} operator`} value={operator} options={operatorOptions} onChange={name => set(field, name, name === '_is_null' ? true : constant)} />
        <Select size="sm" ariaLabel={`${label()} value source`} value={sessionValue(constant) ?? 'fixed'} options={sourceOptions} onChange={source => set(field, operator, source === 'fixed' ? '' : source)} />
        <Show when={!sessionValue(constant)}><Input size="sm" aria-label={`${label()} value`} value={JSON.stringify(constant) ?? ''} onInput={event => set(field, operator, parse(event.currentTarget.value))} /></Show>
      </div>
        <Button type="button" variant="ghost" size="sm" icon aria-label={`Remove ${label()} condition`} onClick={() => { const remaining = without(expression as PolicyPredicate, operator); props.onChange(Object.keys(remaining).length ? { ...props.value, [field]: remaining } as PolicyPredicate : without(props.value, field)); }}><X size={13} aria-hidden="true" /></Button>
      </Panel>;
    }}</For>;
  }}</For></div>;
}
