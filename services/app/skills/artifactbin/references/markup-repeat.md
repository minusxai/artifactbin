---
name: markup-repeat
description: >-
  Keyed repeats.
order: 2
---
## Read first

`<For>` repeats a template over a declared table Value or Query; DataTable is
for columns, sorting, paging, virtualization and editable cells. Declare the
data first: [Document data](markup-data.md).

```jsx
<Helmet>
  <Value name="orders" type="table" value={[{order_id:"a", customer:"Alice"}]} />
</Helmet>
<For each={$orders} keyBy="order_id">
  <Card><CardContent>{$_row.customer}</CardContent></Card>
</For>
```

- `each` is one signal reference, not JavaScript; scalar Values cannot hold
  arrays.
- `keyBy` is optional (without it, rows render by index). When given it must
  name a unique non-null string or finite number in every row; an invalid
  key is an error, never an index fallback. `1` and `"1"` are distinct.
- At most 1,000 rows and 50,000 expanded template nodes. No nested For, no
  DataTable inside For, no bound editors inside For (use editable DataTable
  columns). For renders a block wrapper taking `className` and `style`.
- Comments follow an item only with `keyBy` (DataTable: `rowKey`); without
  it they anchor to the For or table. Never reuse a key for another item.

## Dataset images

For fewer than 10 images, write literal `src="ref:ID"` in markup; for 10 or
more, or for filtering and sorting, upload a dataset with an ordinary string
column of image refs and repeat one template. This is guidance,
not a platform limit. Bind the column with the exact string `src="$_row.cover_ref"` on a
native `<img>` (not `AvatarImage`; `src={$_row.cover_ref}` is refused):

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

Null or empty strings omit the source; a bad, deleted or inaccessible ref
shows alt text without stopping the gallery. A public document or dataset
does not grant access to a private image: the viewer needs the image's own
read permission. Changing stored cover strings needs no republish.

## Row action buttons

A row button is `<Button run="$complete">`, inside a keyed `<For>` or a
`<DataTable>` Column:

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

Actions need `keyBy` or `rowKey`. A click captures the current row as
`$_row` (no `$_value`); pending and error state stay with that row's button.
Captures and previews disable actions. The CLI cannot run a mutation binding
`$_row` or `$_value`: press it in a [live session](live-sessions.md).
