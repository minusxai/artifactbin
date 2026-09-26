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

Repeating a template · Dataset images · Identity and comments.

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
surface for comments even when a row disappears. Bound editors inside For are not supported; use editable DataTable columns.
Row mutation buttons are supported when For has a stable keyBy.

## Dataset images

Rule of thumb: for fewer than 10 images, write literal `src="ref:ID"`
references directly in the markup. For 10 or more repeated items, upload a
dataset with image references and metadata, then write one `<For>` template
using the image column. A dataset is useful even below 10 when the page needs
filtering, sorting or a shared selected-item detail view. This is authoring
guidance, not a platform limit; a composed page of distinct illustrations can
still use literal references at any count.

Store uploaded image references such as `ref:abc123` in an ordinary string
column. No special column type or dataset migration is required. Use the exact
string binding `src="$_row.cover_ref"` on a native `<img>`:

```jsx
<Helmet>
  <Import name="shelf" src="ref:bks123" />
  <Query name="books">{`
    select id, title, cover_ref, has_photo from shelf.rows order by position
  `}</Query>
</Helmet>
<For each={$books} keyBy="id">
  <article>
    {($_row.has_photo) && (
      <img src="$_row.cover_ref" alt="$_row.title"
           loading="lazy" width={180} height={240} />
    )}
    {!($_row.has_photo) && (<p>No photograph available</p>)}
    <h2>{$_row.title}</h2>
  </article>
</For>
```

Replace `bks123` with the uploaded dataset ID. A selected-book detail query
can return one row and feed another `<For>` with the same image template.
Filtering, sorting and refreshed rows update the image with the row. Keep
`keyBy="id"` so the item retains its identity. Literal `src="ref:abc123"` still
works. This syntax is for `<img>`, not `AvatarImage`; JavaScript attribute
expressions such as `src={$_row.cover_ref}` are not supported.

Null and empty strings omit the image source. Malformed, wrong-kind, deleted
or inaccessible references show an unavailable image/alt text without stopping
the gallery. `has_photo` only controls your own placeholder; it does not grant access
or guarantee the image is available. A public document or dataset never makes
a private image public. The viewer needs the image's existing read permission.
Sessionless captures can resolve public/unlisted images; a document export key
does not grant access to private cover images, which remain unavailable.
Resolved web URLs use the existing guarded image importer, never direct hotlinks.

Keep `loading="lazy"` and dimensions on the image. Reference resolution may
read image metadata, but original image downloads remain browser-lazy.
Changing a stored dataset's cover strings takes effect on normal query refresh;
the template does not need republishing. Replacing an image uses its current
versioned URL when resolved again. Existing export-cache refresh rules apply.

Deletion checks discover exact `ref:ID` strings in persisted dataset cells and
report owned datasets and their dependent documents. They read current stored
rows, including existing datasets, without a separate index or backfill.
Forced deletion can break covers; soft-deleted assets and their history retain
the existing storage policy. Connected-database values and references assembled
by SQL have no persisted-cell dependency guarantee. Source/data exports keep
references rather than bundling image files; capture exports render permitted images.

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


## Row action buttons

Use `<Button run="$complete">` for a row action. The same declared mutation
works inside keyed `<For>` and `<DataTable>` Column templates:

```jsx
<Helmet>
  <Value name="tasks" type="table" value={[{id: 1, label: "Review", done: false}]} />
  <Mutation name="complete">{`update tasks set done = true where id = $_row.id`}</Mutation>
</Helmet>
<For each={$tasks} keyBy="id">
  <p>{$_row.label}</p>
  <Button run="$complete">Complete</Button>
</For>
<DataTable data="$tasks" rowKey="id">
  <Column col="label" />
  <Column col="done"><Button run="$complete">Complete</Button></Column>
</DataTable>
```

Actions require unique, non-null string or number keys (`keyBy` or `rowKey`).
A click captures the current row as `$_row`; buttons do not supply an edited
`$_value`. Pending state and errors belong to the row and button, surviving
reordering and temporary unmounting. The pending button is disabled; other
rows remain usable. Failures appear beside the button; retry captures the
current row. Existing mutation access checks and query refresh behavior apply.
Captures and static previews disable actions. This example changes local
reader state; a Mutation that writes an imported table (`update tasks.rows …`)
persists shared changes.

The CLI cannot run a mutation that binds `$_row` or `$_value`; press it in a
live session. `afbin query <dataset> --write --input change.sql` works only
where the dataset's policy grants you direct writes, never by default.
