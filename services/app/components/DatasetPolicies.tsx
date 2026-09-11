import { useEffect, useState } from "react";
import { parse as parseYaml } from "yaml";
import { parseDatasetPolicy } from "@artifactbin/utils/dataset-policy";
import type {
  DatasetPolicy,
  DatasetTablePolicy,
  DatasetOperation,
  InsertPermission,
  UpdatePermission,
  DeletePermission,
} from "@artifactbin/contracts";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import {
  PolicyConditions,
  PolicyValueInput,
} from "@/components/PolicyConditions";
import { Button } from "@/components/ui";

type Table = { schema: string; name: string; columns: Array<{ name: string }> };
type State = {
  canManage?: boolean;
  policy: DatasetPolicy | null;
  revision: number;
  tables: Table[];
  writtenBy: Array<{ id: string; title: string | null; mutations: string[] }>;
};
const inputClass =
  "w-full min-w-0 rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none";
const parseList = (text: string) =>
  text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
/** Keep the user's in-progress separators while the policy stores parsed names. */
function CommaListInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join(", "));
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (JSON.stringify(parseList(text)) !== serialized)
      setText(value.join(", "));
  }, [serialized]);
  return (
    <input
      aria-label={label}
      className={inputClass}
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseList(event.target.value));
      }}
    />
  );
}
const operations: DatasetOperation[] = ["insert", "update", "delete"];
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const initial = (tables: Table[]): DatasetPolicy => ({
  version: 1,
  enforcement: "enabled",
  tables: tables.map((t) => ({ table: { schema: t.schema, name: t.name } })),
});
/** Both editors round-trip one schema; authorization remains on the server. */
function DatasetPolicyEditor({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<DatasetPolicy | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const role = "viewer";
  const [tableIndex, setTableIndex] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch(`/api/my/artifacts/${encodeURIComponent(artifactId)}/policy`)
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "Dataset edit access is required to inspect its data rules.",
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
    setNotice("");
    setError("");
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
    return stored && op === "insert"
      ? {
          ...stored,
          columns:
            ("columns" in stored ? stored.columns : undefined) ??
            ("*" as const),
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
  const save = async () => {
    if (!state) return;
    setSaving(true);
    setError("");
    try {
      const policy = draft ? parseDatasetPolicy(draft) : null;
      const response = await fetch(
        `/api/my/artifacts/${encodeURIComponent(artifactId)}/policy`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            policy,
            expectedPolicyRevision: state.revision,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.detail ?? result.error);
      setState({ ...state, policy: result.policy, revision: result.revision });
      setDraft(result.policy);
      setNotice("Access policies saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save policies");
    } finally {
      setSaving(false);
    }
  };
  const dirty = state && pretty(draft) !== pretty(state.policy);
  return (
    <section aria-label="Access policies" className="space-y-6 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-xl font-semibold tracking-tight">
            Control how data can change
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Choose allowed actions, then narrow them with column and row rules.
            Everyone with access uses these same rules.
          </p>
        </div>
        {state?.canManage !== false && state && source === null && (
          <Button
            variant="ghost"
            onClick={() => setSource(pretty(draft ?? initial(state.tables)))}
          >
            Edit JSON / YAML
          </Button>
        )}
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-danger"
        >
          {error}
        </p>
      )}
      {!state && !error && (
        <p role="status" className="text-muted">
          Loading data actions…
        </p>
      )}
      {state?.canManage === false && (
        <p className="text-muted">
          Dataset edit access is required to change these rules.
        </p>
      )}
      {state && state.canManage !== false && (
        <>
          {source !== null ? (
            <section className="space-y-4 rounded-xl border border-edge bg-surface p-5">
              <label className="grid gap-2 font-medium">
                Policy JSON or YAML
                <textarea
                  aria-label="Policy JSON or YAML"
                  spellCheck={false}
                  className={`${inputClass} min-h-96 font-mono text-xs leading-6`}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    try {
                      change(parseDatasetPolicy(parseYaml(source)));
                      setSource(null);
                      setTableIndex(0);
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Invalid policy",
                      );
                    }
                  }}
                >
                  Apply policy source
                </Button>
                <Button variant="ghost" onClick={() => setSource(null)}>
                  Cancel source changes
                </Button>
              </div>
            </section>
          ) : (
            draft && (
              <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0 space-y-4">
                  <label className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-medium text-muted">
                      Rules for table
                    </span>
                    <select
                      aria-label="Policy table"
                      className={`${inputClass} max-w-xs font-mono text-xs`}
                      value={tableIndex}
                      onChange={(e) => setTableIndex(Number(e.target.value))}
                    >
                      {draft.tables.map((t, i) => (
                        <option
                          key={`${t.table.schema}.${t.table.name}`}
                          value={i}
                        >
                          {t.table.schema}.{t.table.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected &&
                    operations.map((op) => (
                      <OperationCard
                        key={`${tableIndex}:${op}`}
                        op={op}
                        permission={permission(op)}
                        columns={columns}
                        onChange={(value) => setPermission(op, value)}
                      />
                    ))}
                </div>
                <aside className="min-w-0 space-y-5">
                  <section className="rounded-xl border border-accent/20 bg-accent-soft/30 p-4">
                    <ShieldCheck size={18} className="mb-3 text-accent" />
                    <h3 className="font-medium">One shared set of rules</h3>
                    <p className="mt-2 text-xs leading-5 text-muted">
                      Sharing decides who has access. These rules apply to
                      viewers, commenters, editors and owners. Existing data
                      stays visible.
                    </p>
                  </section>
                  <section className="space-y-4 rounded-xl border border-edge bg-surface p-4">
                    <h3 className="font-medium">Functions & generation</h3>
                    <label className="grid gap-2 text-xs text-muted">
                      Blocked functions
                      <CommaListInput
                        label="Denied functions"
                        placeholder="e.g. llm, lower"
                        value={draft.execution?.functions?.deny ?? []}
                        onChange={(deny) =>
                          change({
                            ...draft,
                            execution: {
                              ...draft.execution,
                              functions: {
                                ...draft.execution?.functions,
                                deny,
                              },
                            },
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        aria-label="Allow model generation"
                        type="checkbox"
                        className="accent-accent"
                        checked={!!draft.execution?.generation}
                        onChange={(e) => {
                          const execution = { ...draft.execution };
                          if (e.target.checked)
                            execution.generation = {
                              models: ["default"],
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
                      <div className="space-y-3">
                        <p className="text-xs leading-5 text-muted">
                          Requires an approved allowance. Dispatched calls
                          consume it even if the provider or row check fails.
                        </p>
                        <label className="grid gap-2 text-xs text-muted">
                          Approved models
                          <CommaListInput
                            label="Approved models"
                            value={draft.execution.generation.models}
                            onChange={(models) =>
                              change({
                                ...draft,
                                execution: {
                                  ...draft.execution,
                                  generation: {
                                    ...draft.execution!.generation!,
                                    models,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        {(["max_calls", "max_tokens"] as const).map((field) => (
                          <label
                            key={field}
                            className="grid gap-2 text-xs text-muted"
                          >
                            {field === "max_calls"
                              ? "Total call allowance"
                              : "Maximum output tokens per call"}
                            <input
                              aria-label={
                                field === "max_calls"
                                  ? "Total call allowance"
                                  : "Maximum output tokens per call"
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
                  </section>
                  <section className="px-1">
                    <h3 className="font-medium">Connected apps</h3>
                    {state.writtenBy.length ? (
                      <ul className="mt-3 space-y-3">
                        {state.writtenBy.map((w) => (
                          <li key={w.id}>
                            <a
                              href={`/a/${w.id}`}
                              className="text-sm hover:text-accent"
                            >
                              <span>{w.title ?? w.id}</span>{" "}
                              <span aria-hidden="true">↗</span>
                            </a>
                            <p className="mt-1 text-xs text-muted">
                              {w.mutations.join(", ")}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-muted">
                        No apps use these actions yet.
                      </p>
                    )}
                  </section>
                </aside>
              </div>
            )
          )}
          <details className="rounded-lg border border-edge bg-surface px-4 py-3">
            <summary className="cursor-pointer text-xs text-muted">
              Review permission changes
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ["Current", state.policy],
                ["Proposed", draft],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0">
                  <p className="mb-2 text-xs font-medium">{String(label)}</p>
                  <pre className="max-h-60 overflow-auto rounded-lg bg-raised/30 p-3 text-xs">
                    {pretty(value)}
                  </pre>
                </div>
              ))}
            </div>
          </details>
          <footer className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-md">
            <p
              role="status"
              className={`text-xs ${notice ? "text-accent" : "text-muted"}`}
            >
              {notice ||
                (dirty
                  ? "You have unsaved rule changes."
                  : "Rules are up to date.")}
            </p>
            <Button
              disabled={saving || source !== null}
              onClick={() => void save()}
              className="rounded-lg px-4 py-2"
            >
              {saving ? "Saving policies…" : "Save access policies"}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}

const operationCopy = {
  insert: ["Add rows", "Let people submit new records."],
  update: ["Update rows", "Let people change existing records."],
  delete: ["Delete rows", "Let people remove matching records."],
} as const;
type Permission = InsertPermission | UpdatePermission | DeletePermission;
function OperationCard({
  op,
  permission: p,
  columns,
  onChange,
}: {
  op: DatasetOperation;
  permission: Permission | undefined;
  columns: Table["columns"];
  onChange: (value: Permission | null) => void;
}) {
  const [title, description] = operationCopy[op];
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-xl border bg-surface ${p ? "border-edge-bright" : "border-edge"}`}
    >
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted">{description}</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted">
          <span>{p ? "Allowed" : "Not allowed"}</span>
          <input
            aria-label={`Allow ${op}`}
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={!!p}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? op === "insert"
                    ? { columns: "*", check: {} }
                    : op === "update"
                      ? { columns: "*", filter: {}, check: {} }
                      : { filter: {} }
                  : null,
              )
            }
          />
        </label>
      </header>
      {p && (
        <div className="space-y-5 border-t border-edge px-4 py-5 sm:px-5">
          {"columns" in p && (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">
                Writable columns
              </legend>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  aria-label={`${op} all columns`}
                  className="accent-accent"
                  type="checkbox"
                  checked={(p.columns ?? "*") === "*"}
                  onChange={(e) =>
                    onChange({ ...p, columns: e.target.checked ? "*" : [] })
                  }
                />
                Allow all columns
              </label>
              {p.columns !== undefined && p.columns !== "*" && (
                <div className="flex flex-wrap gap-2">
                  {columns.map((c) => (
                    <label
                      key={c.name}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 font-mono text-xs ${p.columns?.includes(c.name) ? "border-accent/30 bg-accent-soft text-fg" : "border-edge text-muted"}`}
                    >
                      <input
                        aria-label={`${op} column ${c.name}`}
                        className="accent-accent"
                        type="checkbox"
                        checked={p.columns?.includes(c.name) ?? false}
                        onChange={(e) =>
                          onChange({
                            ...p,
                            columns: e.target.checked
                              ? [...(p.columns as string[]), c.name]
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
            </fieldset>
          )}
          {"filter" in p && (
            <PolicyConditions
              label={`${op} filter`}
              title="Which existing rows can change?"
              value={p.filter}
              columns={columns}
              onChange={(filter) => onChange({ ...p, filter })}
            />
          )}
          {op !== "delete" && (
            <>
              <PolicyConditions
                label={`${op} check`}
                title="What must the new values satisfy?"
                value={"check" in p ? (p.check ?? {}) : {}}
                columns={columns}
                onChange={(check) =>
                  onChange({ ...p, check } as InsertPermission)
                }
              />
              <Presets
                op={op}
                columns={columns}
                value={"set" in p ? (p.set ?? {}) : {}}
                onChange={(set) => onChange({ ...p, set } as InsertPermission)}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
function Presets({
  op,
  value,
  columns,
  onChange,
}: {
  op: string;
  value: NonNullable<InsertPermission["set"]>;
  columns: Table["columns"];
  onChange: (value: NonNullable<InsertPermission["set"]>) => void;
}) {
  const available = columns.filter((c) => !(c.name in value));
  return (
    <details
      className="border-t border-edge pt-4"
      open={Object.keys(value).length > 0 || undefined}
    >
      <summary className="cursor-pointer text-xs font-medium text-muted">
        Set values automatically{" "}
        {Object.keys(value).length > 0 && `(${Object.keys(value).length})`}
      </summary>
      <p className="my-3 text-xs leading-5 text-muted">
        These values override submitted values for the selected columns.
      </p>
      <div className="space-y-2">
        {Object.entries(value).map(([name, constant]) => (
          <div
            key={name}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
          >
            <span className="truncate font-mono text-xs">{name}</span>
            <PolicyValueInput
              label={`${op} preset ${name}`}
              value={constant}
              onChange={(next) =>
                onChange({ ...value, [name]: next as typeof constant })
              }
            />
            <Tooltip content="Remove preset">
              <button
                type="button"
                aria-label={`Remove ${op} preset ${name}`}
                className="rounded-md p-2 text-muted hover:text-danger"
                onClick={() =>
                  onChange(
                    Object.fromEntries(
                      Object.entries(value).filter(([key]) => key !== name),
                    ),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      {available.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <Plus size={14} className="text-muted" />
          <select
            aria-label={`Add ${op} preset`}
            className={`${inputClass} max-w-xs`}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange({ ...value, [e.target.value]: "" });
            }}
          >
            <option value="">Choose a column to set…</option>
            {available.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
    </details>
  );
}

export function DatasetPolicies({
  artifactId,
  expanded = false,
}: {
  artifactId: string;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  return (
    <div>
      {!expanded && (
        <Button
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Manage access policies
        </Button>
      )}
      {open && <DatasetPolicyEditor artifactId={artifactId} />}
    </div>
  );
}
