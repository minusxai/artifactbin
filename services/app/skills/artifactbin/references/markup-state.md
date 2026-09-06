---
name: markup-state
description: >-
  Reactive JSX, dialogs, SQL local state.
---
## Read first

Visible interactions need no author script. Scalar Values bind to controls;
restricted JSX reads their current snapshot. This is interpreted data, not JavaScript execution.

```jsx
<Helmet>
  <Value name="view" type="string" default="table" />
  <Value name="editing" type="boolean" default={false} />
  <Value name="drafts" type="table" value={[{id:1,title:"Draft"}]} />
  <Mutation name="show_dag">{`update _signals set view='dag'`}</Mutation>
  <Mutation name="add_draft">{`insert into drafts values (2,'Another')`}</Mutation>
</Helmet>
<Button run="$show_dag">DAG</Button>
{$view === "table" ? <p>Table view</p> : <p>DAG view</p>}
<Dialog open="$editing">
  <DialogTrigger>Edit draft</DialogTrigger>
  <DialogContent aria-label="Edit draft" className="m-auto rounded-xl bg-card p-6">
    <p>Compose ordinary controls here.</p><DialogClose>Close</DialogClose>
  </DialogContent>
</Dialog>
```

## Expressions

Read `$name` scalar signals, or `$_row.field` inside a DataTable Column.
Allowed operators: `!`, `&&`, `||`, `===`, `!==`, `<`, `<=`, `>`, `>=`.
Ordering compares matching string or numeric types; it does not coerce null.
Use `&&` (not bitwise `&`) for conditional markup, or a ternary. Fragments
and nested conditionals compose. Both branches are validated and retain node IDs.
String/number expressions render as text; booleans/null render nothing.
Numeric zero on the left of `&&` renders zero, like JSX.

Boolean props `hidden`, `disabled`, and `open` accept these expressions.
Calls, assignments, arbitrary properties, globals, dynamic URL expressions,
and event handlers remain rejected. This is not arbitrary React code.

## SQL local state

`_signals` projects all scalar Values as one typed row. UPDATE only; changing
several columns commits atomically. Inline table Values support INSERT,
UPDATE, and DELETE, using their declared columns/types. Use simple unqualified
target names. Queries see current local rows. Existing `Button run=` and row
editing controls can invoke these mutations.

Local SQL uses the existing server SQL engine and a round trip, but writes no
dataset or artifact version. Each viewer owns their local rows, which reset on
reload. Scalar Values retain existing URL-backed sharing/persistence behavior.
Live source updates preserve drafts only while the declaration is unchanged.
Persistent mutations still target `ref_<id>` and require dataset edit permission.
A mutation cannot combine local and persistent writes.

## Dialogs

`Dialog` groups triggers, content, and close buttons. Omit `open` for internal
state, or bind `open="$boolean"` for two-way signal state. An expression such
as `open={$editing}` is a one-way controlled value; use the string binding if
triggers and Escape must write back. `DialogContent` uses the browser's modal
top layer, focus trap, and Escape; `DialogClose` closes it.

For a validated submit-and-close flow, put `run="$mutation"` on
`DialogContent`, with native inputs and `<button type="submit">Save</button>`
inside. It validates required inputs, disables submission/cancel while pending,
shows errors, and closes only on success. A static preview cannot submit.
Optional `conflictMessage` supplies a human explanation for row-change conflicts.
