import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PolicyPredicate } from "@artifactbin/contracts";
import { Tooltip } from "@/components/Tooltip";

const input =
  "min-w-0 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none";
const operators: Record<string, string> = {
  _eq: "equals",
  _neq: "does not equal",
  _gt: "greater than",
  _gte: "at least",
  _lt: "less than",
  _lte: "at most",
  _in: "is one of",
  _nin: "is not one of",
  _is_null: "is null",
};
const parseValue = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const without = (value: PolicyPredicate, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
const action =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-fg";

export function PolicyValueInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value) ?? "");
  useEffect(() => {
    if (JSON.stringify(parseValue(text)) !== JSON.stringify(value))
      setText(JSON.stringify(value) ?? "");
  }, [value]);
  return (
    <input
      className={input}
      aria-label={label}
      value={text}
      placeholder="Value"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseValue(e.target.value));
      }}
    />
  );
}
function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip content="Remove">
      <button
        type="button"
        aria-label={label}
        className="shrink-0 rounded-md p-2 text-muted hover:bg-danger-soft hover:text-danger"
        onClick={onClick}
      >
        <Trash2 size={15} />
      </button>
    </Tooltip>
  );
}

/** Recursive editing preserves the predicate's exact boolean structure and sibling fields. */
export function PolicyConditions({
  label,
  title,
  value,
  columns,
  onChange,
}: {
  label: string;
  title: string;
  value: PolicyPredicate;
  columns: Array<{ name: string }>;
  onChange: (value: PolicyPredicate) => void;
}) {
  const condition = () => ({ [columns[0]?.name ?? "column"]: { _eq: "" } });
  const append = (next: PolicyPredicate) => {
    if (Object.keys(value).length === 1 && Array.isArray(value._and))
      onChange({ _and: [...value._and, next] });
    else
      onChange({ _and: [...(Object.keys(value).length ? [value] : []), next] });
  };
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium text-fg">{title}</legend>
      {Object.keys(value).length ? (
        <Predicate
          label={label}
          value={value}
          columns={columns}
          onChange={onChange}
        />
      ) : (
        <p className="rounded-lg bg-raised/40 px-3 py-3 text-xs text-muted">
          No conditions. All rows are allowed.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={action}
          aria-label={`Add ${label} condition`}
          onClick={() => append(condition())}
        >
          <Plus size={14} />
          Add condition
        </button>
        <button
          type="button"
          className={action}
          aria-label={`Add ${label} group`}
          onClick={() => append({ _or: [condition()] })}
        >
          <Plus size={14} />
          Add group
        </button>
        {Object.keys(value).length > 0 && (
          <button
            type="button"
            className={action}
            aria-label={`Clear ${label}`}
            onClick={() => onChange({})}
          >
            Clear all
          </button>
        )}
      </div>
    </fieldset>
  );
}
function Predicate({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: PolicyPredicate;
  columns: Array<{ name: string }>;
  onChange: (value: PolicyPredicate) => void;
}) {
  if (!Object.keys(value).length)
    return (
      <button
        type="button"
        className={action}
        aria-label={`Add ${label} empty condition`}
        onClick={() =>
          onChange({ [columns[0]?.name ?? "column"]: { _eq: "" } })
        }
      >
        <Plus size={14} />
        Add condition
      </button>
    );
  let row = 0;
  return (
    <div className="min-w-0 space-y-2">
      {Object.entries(value).map(([field, expression]) => {
        if (field === "_and" || field === "_or" || field === "_not") {
          const children =
            field === "_not"
              ? [expression as PolicyPredicate]
              : (expression as PolicyPredicate[]);
          return (
            <div
              key={field}
              className="min-w-0 rounded-xl border border-edge bg-raised/20 p-3"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-muted">Match</span>
                <select
                  className="rounded-md border border-edge bg-surface px-2 py-1 text-xs text-fg"
                  aria-label={`${label} match`}
                  value={field}
                  onChange={(e) => {
                    const mode = e.target.value;
                    onChange({
                      ...without(value, field),
                      [mode]:
                        mode === "_not"
                          ? children.length === 1
                            ? children[0]
                            : { _and: children }
                          : children,
                    });
                  }}
                >
                  <option value="_and">All conditions</option>
                  <option value="_or">Any condition</option>
                  <option value="_not">Not this group</option>
                </select>
              </div>
              {!children.length && (
                <p className="text-xs text-muted">
                  {field === "_or"
                    ? "No alternatives. No rows match."
                    : "No conditions. All rows match."}
                </p>
              )}
              {children.map((child, i) => (
                <div key={i} className="mt-2 flex min-w-0 items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <Predicate
                      label={`${label}.${i + 1}`}
                      value={child}
                      columns={columns}
                      onChange={(next) =>
                        onChange({
                          ...value,
                          [field]:
                            field === "_not"
                              ? next
                              : Object.keys(next).length
                                ? children.map((c, j) => (j === i ? next : c))
                                : children.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </div>
                  <Remove
                    label={`Remove ${label}.${i + 1} group`}
                    onClick={() =>
                      onChange(
                        field === "_not"
                          ? without(value, field)
                          : {
                              ...value,
                              [field]: children.filter((_, j) => j !== i),
                            },
                      )
                    }
                  />
                </div>
              ))}
              {field !== "_not" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={action}
                    aria-label={`Add ${label} group condition`}
                    onClick={() =>
                      onChange({
                        ...value,
                        [field]: [
                          ...children,
                          { [columns[0]?.name ?? "column"]: { _eq: "" } },
                        ],
                      })
                    }
                  >
                    <Plus size={13} />
                    Condition
                  </button>
                  <button
                    type="button"
                    className={action}
                    aria-label={`Add ${label} nested group`}
                    onClick={() =>
                      onChange({
                        ...value,
                        [field]: [...children, { _and: [] }],
                      })
                    }
                  >
                    <Plus size={13} />
                    Group
                  </button>
                </div>
              )}
            </div>
          );
        }
        return Object.entries(expression as Record<string, unknown>).map(
          ([operator, constant]) => {
            const name = `${label}.${++row}`;
            const set = (
              nextField: string,
              nextOperator: string,
              nextValue: unknown,
            ) => {
              const remaining = without(
                expression as PolicyPredicate,
                operator,
              );
              const siblings = Object.keys(remaining).length
                ? { ...value, [field]: remaining }
                : without(value, field);
              if (
                Object.hasOwn(
                  (siblings[nextField] as object) ?? {},
                  nextOperator,
                )
              )
                onChange({
                  _and: [
                    siblings,
                    { [nextField]: { [nextOperator]: nextValue } },
                  ],
                });
              else
                onChange({
                  ...siblings,
                  [nextField]: {
                    ...((siblings[nextField] as object) ?? {}),
                    [nextOperator]: nextValue,
                  },
                });
            };
            return (
              <div
                key={`${field}:${operator}`}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-1 rounded-lg border border-edge bg-surface p-2"
              >
                <div className="grid min-w-0 gap-2 sm:grid-cols-[1fr_1fr_1.2fr]">
                  <select
                    className={input}
                    aria-label={`${name} column`}
                    value={field}
                    onChange={(e) => set(e.target.value, operator, constant)}
                  >
                    {[...new Set([field, ...columns.map((c) => c.name)])].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                  <select
                    className={input}
                    aria-label={`${name} operator`}
                    value={operator}
                    onChange={(e) =>
                      set(
                        field,
                        e.target.value,
                        e.target.value === "_is_null" ? true : constant,
                      )
                    }
                  >
                    {Object.entries(operators).map(([op, text]) => (
                      <option key={op} value={op}>
                        {text}
                      </option>
                    ))}
                    {!operators[operator] && <option>{operator}</option>}
                  </select>
                  <PolicyValueInput
                    label={`${name} value`}
                    value={constant}
                    onChange={(next) => set(field, operator, next)}
                  />
                </div>
                <Remove
                  label={`Remove ${name} condition`}
                  onClick={() => {
                    const remaining = without(
                      expression as PolicyPredicate,
                      operator,
                    );
                    onChange(
                      Object.keys(remaining).length
                        ? { ...value, [field]: remaining }
                        : without(value, field),
                    );
                  }}
                />
              </div>
            );
          },
        );
      })}
    </div>
  );
}
