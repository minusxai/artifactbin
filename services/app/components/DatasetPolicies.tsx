import { useEffect, useState } from 'react';
import { parse as parseYaml } from 'yaml';
import { parseDatasetPolicy } from '@artifactbin/utils/dataset-policy';
import type {
  DatasetPolicy,
  DatasetTablePolicy,
  DatasetOperation,
  PolicyPredicate,
  InsertPermission,
  UpdatePermission,
  DeletePermission,
} from '@artifactbin/contracts';
import { Button } from '@/components/ui';

type Table = { schema: string; name: string; columns: Array<{ name: string }> };
type State = {
  canManage?: boolean;
  policy: DatasetPolicy | null;
  revision: number;
  tables: Table[];
  writtenBy: Array<{ id: string; title: string | null; mutations: string[] }>;
};
const inputClass =
  'w-full rounded border border-edge bg-surface px-2 py-1.5 text-sm text-fg';
const operations: DatasetOperation[] = ['insert', 'update', 'delete'];
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const initial = (tables: Table[]): DatasetPolicy => ({
  version: 1,
  enforcement: 'enabled',
  tables: tables.map((t) => ({ table: { schema: t.schema, name: t.name } })),
});
function Conditions({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: PolicyPredicate;
  columns: Table['columns'];
  onChange: (p: PolicyPredicate) => void;
}) {
  const [column, setColumn] = useState(columns[0]?.name ?? '');
  const [op, setOp] = useState('_eq');
  const [constant, setConstant] = useState('');
  const [error, setError] = useState('');
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold">{label}</legend>
      <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-muted">
        {pretty(value)}
      </pre>
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label={`${label} column`}
          className={inputClass}
          value={column}
          onChange={(e) => setColumn(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          aria-label={`${label} operator`}
          className={inputClass}
          value={op}
          onChange={(e) => setOp(e.target.value)}
        >
          {[
            '_eq',
            '_neq',
            '_gt',
            '_gte',
            '_lt',
            '_lte',
            '_in',
            '_nin',
            '_is_null',
          ].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      <input
        aria-label={`${label} value`}
        className={inputClass}
        placeholder="Value (JSON for numbers, lists, or booleans)"
        value={constant}
        onChange={(e) => setConstant(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            try {
              let v: unknown = constant;
              try {
                v = JSON.parse(constant);
              } catch {
                /* Unquoted input is a string. */
              }
              const next = { [column]: { [op]: v } };
              onChange(
                Object.keys(value).length ? { _and: [value, next] } : next,
              );
              setError('');
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Add {label.toLowerCase()} condition
        </Button>
        <Button variant="ghost" onClick={() => onChange({})}>
          Clear {label.toLowerCase()}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
/** Both editors round-trip one schema; authorization remains on the server. */
function DatasetPolicyEditor({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<DatasetPolicy | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const role = 'viewer';
  const [tableIndex, setTableIndex] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch(`/api/my/artifacts/${encodeURIComponent(artifactId)}/policy`)
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            'Dataset edit access is required to inspect its data rules.',
          );
        return r.json() as Promise<State>;
      })
      .then((s) => {
        if (active) {
          setState(s);
          setDraft(s.policy ?? initial(s.tables));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [artifactId]);
  const change = (next: DatasetPolicy | null) => {
    setDraft(next);
    setNotice('');
    setError('');
  };
  const selected = draft?.tables[tableIndex];
  const columns =
    state?.tables.find(
      (t) =>
        t.schema === selected?.table.schema && t.name === selected.table.name,
    )?.columns ?? [];
  const updateTable = (next: DatasetTablePolicy) =>
    change({
      ...draft!,
      tables: draft!.tables.map((t, i) => (i === tableIndex ? next : t)),
    });
  const permission = (op: DatasetOperation) => {
    const stored = selected?.[`${op}_permissions`]?.find(
      (e) => e.role === role,
    )?.permission;
    return stored && op === 'insert'
      ? {
          ...stored,
          columns:
            ('columns' in stored ? stored.columns : undefined) ??
            ('*' as const),
        }
      : stored;
  };
  const setPermission = (
    op: DatasetOperation,
    value: InsertPermission | UpdatePermission | DeletePermission | null,
  ) => {
    if (!selected) return;
    const field = `${op}_permissions` as const;
    const existing = selected[field]?.find((e) => e.role === role);
    const entries = (selected[field] ?? []).filter((e) => e.role !== role);
    updateTable({
      ...selected,
      [field]: value
        ? [...entries, { ...existing, role, permission: value }]
        : entries,
    });
  };
  return (
    <section
      aria-label="Access policies"
      className="space-y-4 border-t border-edge pt-4 text-sm"
    >
      <div>
        <h2 className="font-semibold">Data actions</h2>
        <p className="mt-1 text-xs text-muted">
          Sharing decides who can view this dataset. These rules apply equally
          to viewers, commenters, editors and owners. They do not hide existing
          data.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-accent">
          {notice}
        </p>
      )}
      {state?.canManage === false && (
        <div>
          <p>Only the dataset owner can change these rules.</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">
            {pretty(state.policy)}
          </pre>
        </div>
      )}
      {state && state.canManage !== false && (
        <>
          {draft && source === null && (
            <div className="space-y-4">
              <label className="grid gap-1">
                Table
                <select
                  aria-label="Policy table"
                  className={inputClass}
                  value={tableIndex}
                  onChange={(e) => setTableIndex(Number(e.target.value))}
                >
                  {draft.tables.map((t, i) => (
                    <option key={i} value={i}>
                      {t.table.schema}.{t.table.name}
                    </option>
                  ))}
                </select>
              </label>
              {selected &&
                operations.map((op) => {
                  const p = permission(op);
                  return (
                    <fieldset
                      key={op}
                      className="space-y-3 rounded border border-edge p-3"
                    >
                      <legend>
                        <label className="flex items-center gap-2">
                          <input
                            aria-label={`Allow ${op}`}
                            type="checkbox"
                            checked={!!p}
                            onChange={(e) =>
                              setPermission(
                                op,
                                e.target.checked
                                  ? op === 'insert'
                                    ? { columns: '*', check: {} }
                                    : op === 'update'
                                      ? { columns: '*', filter: {}, check: {} }
                                      : { filter: {} }
                                  : null,
                              )
                            }
                          />
                          {op.toUpperCase()}
                        </label>
                      </legend>
                      {p && (
                        <>
                          {'columns' in p && (
                            <div className="space-y-2">
                              <label className="flex items-center gap-2">
                                <input
                                  aria-label={`${op} all columns`}
                                  type="checkbox"
                                  checked={(p.columns ?? '*') === '*'}
                                  onChange={(e) =>
                                    setPermission(op, {
                                      ...p,
                                      columns: e.target.checked ? '*' : [],
                                    })
                                  }
                                />
                                All writable columns
                              </label>
                              {p.columns !== undefined &&
                                p.columns !== '*' &&
                                columns.map((c) => (
                                  <label
                                    key={c.name}
                                    className="mr-3 inline-flex items-center gap-1"
                                  >
                                    <input
                                      aria-label={`${op} column ${c.name}`}
                                      type="checkbox"
                                      checked={
                                        p.columns?.includes(c.name) ?? false
                                      }
                                      onChange={(e) =>
                                        setPermission(op, {
                                          ...p,
                                          columns: e.target.checked
                                            ? [
                                                ...(p.columns as string[]),
                                                c.name,
                                              ]
                                            : (p.columns as string[]).filter(
                                                (x) => x !== c.name,
                                              ),
                                        })
                                      }
                                    />
                                    {c.name}
                                  </label>
                                ))}
                            </div>
                          )}
                          {'filter' in p && (
                            <Conditions
                              label={`${op} filter`}
                              value={p.filter}
                              columns={columns}
                              onChange={(filter) =>
                                setPermission(op, { ...p, filter })
                              }
                            />
                          )}
                          {op !== 'delete' && (
                            <Conditions
                              label={`${op} check`}
                              value={'check' in p ? (p.check ?? {}) : {}}
                              columns={columns}
                              onChange={(check) =>
                                setPermission(op, {
                                  ...p,
                                  check,
                                } as InsertPermission)
                              }
                            />
                          )}
                        </>
                      )}
                    </fieldset>
                  );
                })}
              <label className="grid gap-1">
                Denied functions
                <input
                  aria-label="Denied functions"
                  className={inputClass}
                  placeholder="llm, lower"
                  value={draft.execution?.functions?.deny?.join(', ') ?? ''}
                  onChange={(e) =>
                    change({
                      ...draft,
                      execution: {
                        ...draft.execution,
                        functions: {
                          ...draft.execution?.functions,
                          deny: e.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  aria-label="Allow model generation"
                  type="checkbox"
                  checked={!!draft.execution?.generation}
                  onChange={(e) => {
                    const execution = { ...draft.execution };
                    if (e.target.checked)
                      execution.generation = {
                        models: ['default'],
                        max_calls: 100,
                        max_tokens: 1024,
                      };
                    else delete execution.generation;
                    change({ ...draft, execution });
                  }}
                />
                Allow model generation
              </label>
              {draft.execution?.generation && (
                <div className="space-y-2">
                  <p className="text-xs text-muted">
                    Generation also requires a server-authorized allowance.
                    Calls consume the allowance even if a provider fails or a
                    later row check rejects the result.
                  </p>
                  <label className="grid gap-1">
                    Approved models
                    <input
                      aria-label="Approved models"
                      className={inputClass}
                      value={draft.execution.generation.models.join(', ')}
                      onChange={(e) =>
                        change({
                          ...draft,
                          execution: {
                            ...draft.execution,
                            generation: {
                              ...draft.execution!.generation!,
                              models: e.target.value
                                .split(',')
                                .map((x) => x.trim())
                                .filter(Boolean),
                            },
                          },
                        })
                      }
                    />
                  </label>
                  {(['max_calls', 'max_tokens'] as const).map((field) => (
                    <label className="grid gap-1" key={field}>
                      {field === 'max_calls'
                        ? 'Total call allowance'
                        : 'Maximum output tokens per call'}
                      <input
                        aria-label={
                          field === 'max_calls'
                            ? 'Total call allowance'
                            : 'Maximum output tokens per call'
                        }
                        type="number"
                        min={1}
                        className={inputClass}
                        value={draft.execution!.generation![field]}
                        onChange={(e) =>
                          change({
                            ...draft,
                            execution: {
                              ...draft.execution,
                              generation: {
                                ...draft.execution!.generation!,
                                [field]: Number(e.target.value),
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {source === null ? (
            <Button
              variant="ghost"
              onClick={() => setSource(pretty(draft ?? initial(state.tables)))}
            >
              Edit JSON / YAML
            </Button>
          ) : (
            <div className="space-y-2">
              <label className="grid gap-1">
                Policy JSON or YAML
                <textarea
                  aria-label="Policy JSON or YAML"
                  className={`${inputClass} min-h-64 font-mono text-xs`}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <Button
                onClick={() => {
                  try {
                    const next = parseDatasetPolicy(parseYaml(source));
                    change(next);
                    setSource(null);
                    setTableIndex(0);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Invalid policy');
                  }
                }}
              >
                Apply policy source
              </Button>
              <Button variant="ghost" onClick={() => setSource(null)}>
                Cancel source changes
              </Button>
            </div>
          )}
          <div>
            <p className="font-semibold">Affected apps and actions</p>
            {state.writtenBy.length ? (
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {state.writtenBy.map((w) => (
                  <li key={w.id}>
                    <a href={`/a/${w.id}`} className="underline">
                      {w.title ?? w.id}
                    </a>
                    : {w.mutations.join(', ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No dependent actions found.</p>
            )}
          </div>
          <details>
            <summary className="cursor-pointer">
              Review permission changes
            </summary>
            <div className="grid gap-2">
              <div>
                <p>Current</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                  {pretty(state.policy)}
                </pre>
              </div>
              <div>
                <p>Proposed</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                  {pretty(draft)}
                </pre>
              </div>
            </div>
          </details>
          <Button
            disabled={saving || source !== null}
            onClick={async () => {
              setSaving(true);
              setError('');
              try {
                const policy = draft ? parseDatasetPolicy(draft) : null;
                const r = await fetch(
                  `/api/my/artifacts/${encodeURIComponent(artifactId)}/policy`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      policy,
                      expectedPolicyRevision: state.revision,
                    }),
                  },
                );
                const result = await r.json();
                if (!r.ok) throw Error(result.detail ?? result.error);
                setState({
                  ...state,
                  policy: result.policy,
                  revision: result.revision,
                });
                setDraft(result.policy);
                setNotice('Access policies saved.');
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : 'Could not save policies',
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving policies…' : 'Save access policies'}
          </Button>
        </>
      )}
    </section>
  );
}

export function DatasetPolicies({ artifactId }: { artifactId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Manage access policies
      </Button>
      {open && <DatasetPolicyEditor artifactId={artifactId} />}
    </div>
  );
}
