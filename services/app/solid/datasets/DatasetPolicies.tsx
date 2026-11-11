/* @jsxImportSource solid-js */
/**
 * THE APP'S DATASET PERMISSIONS EDITOR (version 3, Hasura's metadata shape). It speaks the agent policy API
 * (`/api/artifacts/:id/policy`, lib/dataset-access `policy`) through the browser session, so the app and agents
 * read, check and save the same document: a per-table grid of rule roles × operations, the three server-built
 * templates, the server's dry-run read-back and errors by path, a save at the loaded revision, and a notice when
 * the stored policy cannot be read (saving replaces it). Owner and editors always have full access and take no
 * rules. The server stays the validation and admission boundary for every write.
 */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import X from 'lucide-solid/icons/x';
import {
  DATASET_PERMISSION_OPERATIONS,
  DATASET_RULE_ROLES,
  type DatasetBoolExp,
  type DatasetPermissionEntry,
  type DatasetPermissionOperation,
  type DatasetPermissions,
  type DatasetPermissionsIssue,
  type DatasetPermissionTemplate,
  type DatasetPermissionWarning,
  type DatasetRuleRole,
  type DatasetTablePermissions,
  type PolicyPredicate,
} from '@artifactbin/contracts';
import { Button } from '../ui/Button';
import { Checkbox, Switch } from '../ui/Checkbox';
import { Field, Input, Textarea } from '../ui/Field';
import { SectionHeading } from '../ui/PageHeader';
import { Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';
import { Tabs } from '../ui/Tabs';
import { PolicyConditions } from './PolicyConditions';
import { apiFetch } from '../lib/api';

type Op = DatasetPermissionOperation;
type Role = DatasetRuleRole;
type Rule = { columns?: '*' | string[]; filter?: DatasetBoolExp; check?: DatasetBoolExp | null; set?: Record<string, unknown>; limit?: number; allow_aggregations?: boolean; backend_only?: boolean };
type Entry = DatasetPermissionEntry<Rule>;
type ReadBackTable = { title: string; lines: string[] };
type Loaded = {
  revision: number;
  source: 'v3' | 'none' | 'unreadable';
  report: Array<{ code: string; message: string }>;
  policy: DatasetPermissions | null;
  tables: Array<{ table: { schema: string; name: string }; root: string; columns: Array<{ name: string; type?: string }> }>;
  readBackTables: ReadBackTable[];
  warnings: DatasetPermissionWarning[];
};
type Check = { tables: ReadBackTable[]; warnings: DatasetPermissionWarning[]; errors: DatasetPermissionsIssue[] };
type Template = { name: DatasetPermissionTemplate; ok: boolean; policy?: DatasetPermissions; errors?: DatasetPermissionsIssue[] };

const ROLE_LABEL: Record<Role, string> = { viewer: 'Shared viewers', signed_in: 'Signed-in link holders', anonymous: 'Signed-out link holders' };
const ROLE_HINT: Record<Role, string> = { viewer: 'people the dataset is shared with', signed_in: 'signed-in accounts with the link', anonymous: 'anyone with the link, signed out' };
const VERB: Record<Op, string> = { select: 'see', insert: 'add', update: 'change', delete: 'delete' };
const MODES = { off: 'Off', all: 'All rows', some: 'Some rows' } as const;
type Mode = keyof typeof MODES;
const TEMPLATE_LABEL: Record<DatasetPermissionTemplate, string> = { 'read-only': 'Everyone who reaches the dataset reads; only owner and editors change rows.', 'own-rows': 'Everyone reads; shared viewers and signed-in link holders add rows and change or delete their own.', 'editors-only': 'Only owner and editors read or write; the dataset is not found for everyone else.' };
const SESSION_PRESETS = [{ value: 'X-Hasura-User-Id', label: 'Current user ID' }, { value: 'X-Hasura-Page-Id', label: 'Current page ID' }, { value: 'fixed', label: 'Fixed value' }];
const fieldOf = (op: Op) => `${op}_permissions` as const;
const empty = (value: unknown) => !value || (typeof value === 'object' && !Object.keys(value).length);
const json = (value: unknown) => JSON.stringify(value ?? null);
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const STARTER: Record<Op, Rule> = { select: { columns: '*', filter: {}, allow_aggregations: true }, insert: { columns: '*', check: {} }, update: { columns: '*', filter: {}, check: {} }, delete: { filter: {} } };
/** The row condition a cell's mode reads: the check for adds, the filter for everything else. */
const conditionKey = (op: Op) => op === 'insert' ? 'check' : 'filter';
const policyUrl = (id: string) => `/api/artifacts/${encodeURIComponent(id)}/policy`;

/** The server remains the admission and validation boundary for every policy write. */
export function DatasetPolicies(props: { artifactId: string; expanded?: boolean; saveTarget?: HTMLElement }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.expanded));
  return <div>
    <Show when={!props.expanded}><Button variant="secondary" aria-expanded={open()} onClick={() => setOpen(value => !value)}>Manage access policies</Button></Show>
    <Show when={open()}><PolicyEditor artifactId={props.artifactId} saveTarget={props.saveTarget} /></Show>
  </div>;
}

function PolicyEditor(props: { artifactId: string; saveTarget?: HTMLElement }): JSX.Element {
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [draft, setDraft] = createSignal<DatasetPermissions | null>(null);
  const [tableIndex, setTableIndex] = createSignal(0);
  const [cell, setCell] = createSignal<{ role: Role; op: Op } | null>(null);
  const [view, setView] = createSignal<'rules' | 'json'>('rules');
  const [source, setSource] = createSignal('');
  const [sourceError, setSourceError] = createSignal('');
  const [check, setCheck] = createSignal<Check>({ tables: [], warnings: [], errors: [] });
  const [checking, setChecking] = createSignal(false);
  const [loadError, setLoadError] = createSignal('');
  const [error, setError] = createSignal('');
  const [conflict, setConflict] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [ownerColumn, setOwnerColumn] = createSignal('');
  const [templateBusy, setTemplateBusy] = createSignal(false);

  const accept = (value: Loaded) => {
    setLoaded(value);
    setDraft(value.policy ?? { version: 3, tables: value.tables.map(t => ({ table: { ...t.table } })) });
    setCheck({ tables: value.readBackTables, warnings: value.warnings, errors: [] });
    setConflict(false); setError(''); setCell(null);
  };
  const load = (signal?: AbortSignal) => retryingFetch(policyUrl(props.artifactId), signal ? { signal } : undefined).then(async response => {
    if (!response.ok) throw new Error('Dataset edit access is required to inspect its data rules.');
    return response.json() as Promise<Loaded>;
  }).then(value => { if (!signal?.aborted) accept(value); })
    .catch(cause => { if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : 'Could not load policies.'); });
  onMount(() => { const controller = new AbortController(); onCleanup(() => controller.abort()); void load(controller.signal); });

  const dirty = createMemo(() => { const value = loaded(); return !!value && (!['v3', 'none'].includes(value.source) || json(draft()) !== json(value.policy)); });
  const columns = (index = tableIndex()) => loaded()?.tables[index]?.columns ?? [];
  const allColumns = createMemo(() => [...new Set(loaded()?.tables.flatMap(t => t.columns.map(c => c.name)) ?? [])]);
  const table = createMemo((): DatasetTablePermissions | undefined => draft()?.tables?.[tableIndex()]);
  const entryOf = (role: Role, op: Op): Entry | undefined => ((table()?.[fieldOf(op)] ?? []) as Entry[]).find(e => e.role === role);
  const edit = (next: DatasetPermissions) => { setDraft(next); setNotice(''); setError(''); };
  const setRule = (role: Role, op: Op, permission: Rule | null) => {
    const policy = draft(), current = table(); if (!policy || !current) return;
    const field = fieldOf(op), list = (current[field] ?? []) as Entry[];
    const at = list.findIndex(e => e.role === role);
    const next: Entry[] = permission ? at < 0 ? [...list, { role, permission }] : list.map((e, i) => i === at ? { ...e, permission } : e) : list.filter(e => e.role !== role);
    const nextTable = { ...current } as Record<string, unknown>;
    if (next.length) nextTable[field] = next; else delete nextTable[field];
    edit({ ...policy, tables: policy.tables.map((t, i) => i === tableIndex() ? nextTable as unknown as DatasetTablePermissions : t) });
  };
  const modeOf = (role: Role, op: Op): Mode => { const e = entryOf(role, op); return !e ? 'off' : empty(e.permission[conditionKey(op)]) ? 'all' : 'some'; };
  const setMode = (role: Role, op: Op, mode: Mode) => {
    if (mode === 'off') { setRule(role, op, null); if (cell()?.role === role && cell()?.op === op) setCell(null); return; }
    const prior = entryOf(role, op)?.permission ?? STARTER[op], key = conditionKey(op);
    const condition = mode === 'all' ? {} : empty(prior[key]) ? { [columns()[0]?.name ?? '_id']: { _eq: '' } } : prior[key];
    setRule(role, op, { ...prior, [key]: condition });
    if (mode === 'some') setCell({ role, op });
  };

  // The live check: every draft change is dry-run on the server, which answers the read-back or every problem by path.
  let sequence = 0;
  createEffect(on(() => json(draft()), (text, prior) => {
    if (prior === undefined || !loaded() || !draft()) return;
    const mine = ++sequence;
    if (text === json(loaded()!.policy)) { setCheck({ tables: loaded()!.readBackTables, warnings: loaded()!.warnings, errors: [] }); setChecking(false); return; }
    setChecking(true);
    const timer = setTimeout(() => void apiFetch(policyUrl(props.artifactId), 'PUT', { policy: draft(), dryRun: true }).then(async response => {
      const answer = await response.json().catch(() => ({})) as Record<string, any>;
      if (mine !== sequence) return;
      if (response.ok) setCheck({ tables: answer.readBackTables ?? [], warnings: answer.warnings ?? [], errors: [] });
      else setCheck({ tables: [], warnings: [], errors: answer.errors ?? [{ path: 'policy', message: answer.detail ?? answer.error ?? 'The rules could not be checked.' }] });
    }).catch(() => { if (mine === sequence) setCheck({ tables: [], warnings: [], errors: [{ path: 'policy', message: 'The rules could not be checked. Try again.' }] }); })
      .finally(() => { if (mine === sequence) setChecking(false); }), 200);
    onCleanup(() => clearTimeout(timer));
  }));

  const save = async () => {
    const value = loaded(), policy = draft(); if (!value || !policy) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(policyUrl(props.artifactId), 'PUT', { policy, expectedPolicyRevision: value.revision });
      const answer = await response.json().catch(() => ({})) as Record<string, any>;
      if (response.status === 409) { setConflict(true); return; }
      if (!response.ok) {
        if (Array.isArray(answer.errors)) setCheck({ tables: [], warnings: [], errors: answer.errors });
        throw new Error(answer.detail ?? answer.error ?? 'Could not save policies.');
      }
      accept({ ...value, source: 'v3', report: [], revision: answer.revision, policy: answer.policy, readBackTables: answer.readBackTables ?? [], warnings: answer.warnings ?? [] });
      setNotice('Access policies saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save policies.'); }
    finally { setSaving(false); }
  };

  const applyTemplate = async (name: DatasetPermissionTemplate) => {
    setTemplateBusy(true); setError('');
    try {
      const query = name === 'own-rows' ? `?ownerColumn=${encodeURIComponent(ownerColumn())}` : '';
      const response = await apiFetch(`${policyUrl(props.artifactId)}/templates${query}`);
      if (!response.ok) throw new Error('Could not load templates.');
      const found = ((await response.json()) as { templates: Template[] }).templates.find(t => t.name === name);
      if (!found?.ok || !found.policy) throw new Error(found?.errors?.map(e => e.message).join('; ') || 'That template does not fit this dataset.');
      edit(found.policy); setCell(null); setTableIndex(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the template.'); }
    finally { setTemplateBusy(false); }
  };

  const showJson = (value: string) => {
    if (value === 'json') { setSource(pretty(draft())); setSourceError(''); }
    setView(value as 'rules' | 'json');
  };
  const applySource = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(source()); } catch { setSourceError('This is not valid JSON.'); return; }
    const shaped = parsed as { version?: unknown; tables?: unknown };
    if (!shaped || typeof shaped !== 'object' || shaped.version !== 3 || !Array.isArray(shaped.tables)) { setSourceError('Expected a version 3 policy: {"version": 3, "tables": [...]}.'); return; }
    setSourceError(''); setCell(null); setTableIndex(0); edit(parsed as DatasetPermissions);
  };

  const canSave = () => !!loaded() && dirty() && !saving() && !check().errors.length && !conflict() && view() === 'rules';
  const saveButton = (compact = false) => <Button aria-label="Save access policies" disabled={!canSave()} onClick={() => void save()}>{saving() ? 'Saving…' : compact ? 'Save' : 'Save access policies'}</Button>;

  return <section aria-label="Access policies" class="space-y-5 py-4 text-sm text-fg">
    <header><SectionHeading>Who can see and change this data</SectionHeading>
      <p class="mt-1 text-muted">Rules apply to every read and write of this dataset, directly or through any page that uses it. A role with no rule is denied.</p></header>
    <Show when={loadError()}><StatusMessage kind="error">{loadError()}</StatusMessage></Show>
    <Show when={!loaded() && !loadError()}><StatusMessage kind="loading">Loading data actions…</StatusMessage></Show>
    <Show when={loaded()}>{value => <>
      <Show when={value().source === 'unreadable'}>
        <StatusMessage kind="error">The stored rules could not be read, so nobody below editor can use the data until you save new rules. <For each={value().report}>{item => <span>{item.message}</span>}</For></StatusMessage>
      </Show>
      <Show when={value().source === 'none'}><StatusMessage kind="notice">No rules are saved yet. These are the defaults: everyone who reaches the dataset reads it, and only the owner and editors change rows.</StatusMessage></Show>

      <Panel padding="sm" title="Start from a template" class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-3">
          <For each={['read-only', 'own-rows', 'editors-only'] as DatasetPermissionTemplate[]}>{name => <div class="space-y-2">
            <p class="text-xs text-muted">{TEMPLATE_LABEL[name]}</p>
            <Show when={name === 'own-rows'}><Field label="Owner column"><Select value={ownerColumn()} placeholder="Choose a column" options={allColumns().map(c => ({ value: c, label: c }))} onChange={setOwnerColumn} /></Field></Show>
            <Button variant="secondary" size="sm" disabled={templateBusy() || (name === 'own-rows' && !ownerColumn())} aria-label={`Apply ${name} template`} onClick={() => void applyTemplate(name)}>Apply {name}</Button>
          </div>}</For>
        </div>
      </Panel>

      <Tabs label="Policy view" variant="segmented" size="sm" value={view()} onChange={showJson} items={[{ value: 'rules', label: 'Rules' }, { value: 'json', label: 'Hasura JSON' }]} />
      <Show when={view() === 'rules'} fallback={<div class="space-y-2">
        <Field label="Hasura permissions JSON" hint="The version 3 document: tables[] with select, insert, update and delete permissions. Applying it checks it on the server."><Textarea size="sm" surface="code" rows={22} spellcheck={false} value={source()} onInput={event => setSource(event.currentTarget.value)} /></Field>
        <Show when={sourceError()}><StatusMessage kind="error">{sourceError()}</StatusMessage></Show>
        <div class="flex gap-2"><Button onClick={applySource}>Apply JSON</Button><Button variant="secondary" onClick={() => setView('rules')}>Discard JSON changes</Button></div>
      </div>}>
        <Show when={(draft()?.tables.length ?? 0) > 1}><Field label="Rules for table"><Select value={String(tableIndex())} options={(draft()?.tables ?? []).map((t, i) => ({ value: String(i), label: `${t.table.schema}.${t.table.name}` }))} onChange={next => { setTableIndex(Number(next)); setCell(null); }} /></Field></Show>
        <Show when={table()}>{current => <>
          <Table label={`Permissions for ${current().table.schema}.${current().table.name}`} density="sm">
            <TableHead><TableRow><TableHeaderCell>Role</TableHeaderCell><For each={DATASET_PERMISSION_OPERATIONS}>{op => <TableHeaderCell>{VERB[op]} rows</TableHeaderCell>}</For></TableRow></TableHead>
            <TableBody>
              <For each={['Owner', 'Editors']}>{name => <TableRow><TableHeaderCell scope="row">{name}</TableHeaderCell><TableCell colSpan={4} class="text-muted">Always full access</TableCell></TableRow>}</For>
              <For each={DATASET_RULE_ROLES}>{role => <TableRow>
                <TableHeaderCell scope="row"><span class="block">{ROLE_LABEL[role]}</span><span class="block font-normal normal-case text-muted">{ROLE_HINT[role]}</span></TableHeaderCell>
                <For each={DATASET_PERMISSION_OPERATIONS}>{op => <TableCell><div class="flex items-center gap-1">
                  <Select size="sm" class="w-24" ariaLabel={`${ROLE_LABEL[role]}: ${VERB[op]}`} value={modeOf(role, op)} options={(Object.keys(MODES) as Mode[]).map(m => ({ value: m, label: MODES[m] }))} onChange={m => setMode(role, op, m as Mode)} />
                  <Show when={modeOf(role, op) !== 'off'}><Button variant="ghost" size="sm" pressed={cell()?.role === role && cell()?.op === op} aria-label={`Edit ${ROLE_LABEL[role]} ${VERB[op]} rule`} onClick={() => setCell({ role, op })}>Edit</Button></Show>
                </div></TableCell>}</For>
              </TableRow>}</For>
            </TableBody>
          </Table>
          <Show when={cell() && entryOf(cell()!.role, cell()!.op) ? cell() : null} keyed>{selected => <RuleEditor
            role={selected.role} op={selected.op} columns={columns()} rule={entryOf(selected.role, selected.op)!.permission}
            onChange={rule => setRule(selected.role, selected.op, rule)} onClose={() => setCell(null)} />}</Show>
        </>}</Show>
      </Show>

      <Panel padding="sm" label="Read-back" aria-busy={checking()} class="space-y-2">
        <h3 class="font-semibold">What these rules mean</h3>
        <Show when={check().errors.length}><StatusMessage kind="error"><p>Fix these before saving:</p><ul class="mt-1 list-disc pl-5"><For each={check().errors}>{issue => <li><span class="font-mono">{issue.path}</span>: {issue.message}</li>}</For></ul></StatusMessage></Show>
        <For each={check().tables}>{t => <div><p class="font-medium">{t.title}</p><ul class="list-disc pl-5"><For each={t.lines}>{line => <li>{line}</li>}</For></ul></div>}</For>
        <Show when={check().warnings.length}><StatusMessage kind="caution"><ul class="list-disc pl-5"><For each={check().warnings}>{w => <li>{w.message}</li>}</For></ul></StatusMessage></Show>
        <Show when={checking()}><p class="text-xs text-muted">Checking…</p></Show>
      </Panel>

      <Show when={conflict()}><StatusMessage kind="error" action={<Button variant="secondary" size="sm" onClick={() => void load()}>Reload latest rules</Button>}>These rules, the dataset or its sharing changed since you opened them. Reload the latest rules and reapply your change.</StatusMessage></Show>
      <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
      <Panel padding="sm" class="flex items-center justify-between gap-3"><p role="status">{notice() || (dirty() ? 'You have unsaved rule changes.' : 'Rules are up to date.')}</p><Show when={props.saveTarget} fallback={saveButton()}>{target => <Portal mount={target()}>{saveButton(true)}</Portal>}</Show></Panel>
    </>}</Show>
  </section>;
}

/** One cell's rule: columns, row conditions, presets, and the select and write switches. */
function RuleEditor(props: { role: Role; op: Op; columns: Array<{ name: string; type?: string }>; rule: Rule; onChange: (rule: Rule) => void; onClose: () => void }): JSX.Element {
  const name = () => `${ROLE_LABEL[props.role]} ${VERB[props.op]} rule`;
  const patch = (next: Partial<Rule>) => {
    const rule = { ...props.rule, ...next } as Record<string, unknown>;
    for (const key of Object.keys(next)) if (rule[key] === undefined) delete rule[key];
    props.onChange(rule as Rule);
  };
  const chosen = () => props.rule.columns === undefined || props.rule.columns === '*' ? null : props.rule.columns;
  const presets = () => Object.entries(props.rule.set ?? {});
  const setPresets = (pairs: Array<[string, unknown]>) => patch({ set: pairs.length ? Object.fromEntries(pairs) : undefined });
  const presetSource = (value: unknown) => SESSION_PRESETS.find(p => p.value !== 'fixed' && typeof value === 'string' && p.value.toLowerCase() === value.toLowerCase())?.value ?? 'fixed';
  return <Panel padding="sm" label={name()} class="space-y-4">
    <div class="flex items-center justify-between gap-2"><h3 class="font-semibold">{ROLE_LABEL[props.role]} · {VERB[props.op]} rows</h3>
      <Button variant="ghost" size="sm" icon aria-label={`Close ${name()}`} onClick={props.onClose}><X size={13} aria-hidden="true" /></Button></div>
    <Show when={props.op !== 'delete'}><fieldset class="space-y-2"><legend class="mb-1 text-sm font-medium">Columns</legend>
      <Checkbox label="All columns" checked={!chosen()} onChange={all => patch({ columns: all ? '*' : [] })} />
      <Show when={chosen()}><div class="flex flex-wrap gap-3"><For each={props.columns}>{column => <Checkbox label={column.name} checked={chosen()!.includes(column.name)} onChange={on => patch({ columns: on ? [...chosen()!, column.name] : chosen()!.filter(c => c !== column.name) })} />}</For></div></Show>
    </fieldset></Show>
    <Show when={props.op !== 'insert'}><PolicyConditions label={`${props.op} filter`} title={props.op === 'select' ? 'Which rows can they see?' : 'Which existing rows can they change?'} value={(props.rule.filter ?? {}) as PolicyPredicate} columns={props.columns} onChange={filter => patch({ filter: filter as DatasetBoolExp })} /></Show>
    <Show when={props.op === 'insert' || props.op === 'update'}><PolicyConditions label={`${props.op} check`} title="What must the new values satisfy?" value={(props.rule.check ?? {}) as PolicyPredicate} columns={props.columns} onChange={check => patch({ check: check as DatasetBoolExp })} /></Show>
    <Show when={props.op === 'insert' || props.op === 'update'}><fieldset class="space-y-2"><legend class="mb-1 text-sm font-medium">Presets: values the server fills in</legend>
      <Index each={presets()}>{(pair, index) => {
        const label = `Preset ${index + 1}`;
        const replace = (column: string, value: unknown) => setPresets(presets().map((p, i) => i === index ? [column, value] : p));
        return <div class="flex flex-wrap items-center gap-2">
          <Select size="sm" class="w-40" ariaLabel={`${label} column`} value={pair()[0]} options={[...new Set([pair()[0], ...props.columns.map(c => c.name)])].map(c => ({ value: c, label: c }))} onChange={column => replace(column, pair()[1])} />
          <Select size="sm" class="w-40" ariaLabel={`${label} value`} value={presetSource(pair()[1])} options={SESSION_PRESETS} onChange={source => replace(pair()[0], source === 'fixed' ? '' : source)} />
          <Show when={presetSource(pair()[1]) === 'fixed'}><Input size="sm" class="w-40" aria-label={`${label} fixed value`} value={String(pair()[1] ?? '')} onInput={event => replace(pair()[0], event.currentTarget.value)} /></Show>
          <Button variant="ghost" size="sm" icon aria-label={`Remove ${label.toLowerCase()}`} onClick={() => setPresets(presets().filter((_, i) => i !== index))}><X size={13} aria-hidden="true" /></Button>
        </div>;
      }}</Index>
      <Button variant="ghost" size="sm" onClick={() => setPresets([...presets(), [props.columns.find(c => !presets().some(([k]) => k === c.name))?.name ?? props.columns[0]?.name ?? '', 'X-Hasura-User-Id']])}>Add preset</Button>
    </fieldset></Show>
    <Show when={props.op === 'select'}><div class="flex flex-wrap items-end gap-4">
      <div class="flex items-center gap-2"><Switch label="Allow SQL (totals, group by, joins)" checked={props.rule.allow_aggregations === true} onChange={on => patch({ allow_aggregations: on || undefined })} /><span aria-hidden="true">Allow counts and totals</span></div>
      <Field label="Row limit" hint="Empty: up to 1000 rows a request."><Input size="sm" class="w-28" type="number" min="1" max="1000" value={props.rule.limit ?? ''} onInput={event => { const n = Number.parseInt(event.currentTarget.value, 10); patch({ limit: Number.isFinite(n) ? n : undefined }); }} /></Field>
    </div></Show>
    <Show when={props.op !== 'select'}><div class="flex items-center gap-2"><Switch label="Only through the owner's apps" checked={props.rule.backend_only === true} onChange={on => patch({ backend_only: on || undefined })} /><span aria-hidden="true">Only through the owner's apps <span class="text-muted">(saved page actions; never direct API calls)</span></span></div></Show>
  </Panel>;
}
