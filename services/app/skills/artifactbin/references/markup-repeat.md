---
name: markup-repeat
description: >-
  Keyed repeats.
order: 2
---
## Read first

Use For for a JSX template over a declared table Value or Query. Use
DataTable for columns, sorting, paging, virtualization, and editable cells.
Declare the data first: [Document data](markup-data.md).

## Contents

Repeating a template · Identity and comments.

## Repeating a template

Use `<For>` for a template over a declared table Value or Query. Table
signals use the same `$name` namespace as DataTable; ordinary scalar Values
cannot hold arrays.

```jsx
<Helmet>
  <Value name="orders" type="table" value={[{order_id:"a", customer:"Alice"}]} />
</Helmet>
<For each={$orders} keyBy="order_id">
  <Card><CardContent>{$_row.customer}</CardContent></Card>
</For>
```

`each` is a single signal reference, not JavaScript. `keyBy` is optional:
`<For each={$orders}><p>{$_row.customer}</p></For>` renders by row index.
When supplied, `keyBy` must name a unique non-null string or finite number in
every row. An invalid explicit key is an error, not an index fallback. Numeric `1` and
string `"1"` are distinct keys. The template updates with query results and
preserves item identity when rows move if `keyBy` is supplied. Empty results render no items. There
is a limit of 1,000 rows and 50,000 expanded template nodes. Nested For loops,
DataTable, and Iframe inside For templates are not supported. Use DataTable for
large virtualized tabular results, sorting, and paging. For renders a block wrapper accepting class and style, providing an owner
surface for comments even when a row disappears. Bound controls and mutation
buttons inside For are not supported; use editable DataTable columns.

## Identity and comments

Template source IDs are persisted once, and rendered instance IDs are scoped
by the owner and typed row key. Local label, ARIA, and fragment references
are rewritten to the corresponding instance. Comments retain the For owner
and the item/template target when `keyBy` is supplied. Without it, instance DOM
IDs and local references are scoped by index for rendering, but comments anchor
only to the For owner. Selected words can remain as a quote; no positional item,
text-offset or area target is persisted that could attach to another row after
reordering. Add `keyBy` when feedback should follow a particular item. DataTable uses its existing `rowKey` property
for the same durable row/cell targeting. Without `rowKey`, a table still
renders but its rows and cells cannot be durable comment targets. Removing a
row retains its comment's table/For owner; restoring the same key restores
the logical target. Never reuse a key for a different logical item.
