---
name: markup-state
description: >-
  Explains local state.
order: 2
---
## Read first

Scalar Values hold choices and flags, inline table Values hold temporary rows,
Queries derive the view. Markup conditions (`{$editing && …}`, `{$step > 1 ?
… : …}`) read declared scalars only; anything computed belongs in the
[script](markup-scripts.md).

Custom scripts can also use ordinary Solid local state. A native comment
saves the Values the link carries, kit view state and named script signals,
and restores them when it opens: [saved comment views](review-state.md).

Text fields: `<Input label="Title" value="$title" />`
(`type="text|number|email|url|search|password"`, `placeholder`, `min`, `max`,
`step`, `required`) and `<Textarea label="Note" value="$note" rows={3} />`,
beside `Select`, `Segmented`, `Slider`, `DatePicker` and `Switch`. Native
`<input>`/`<select>`/`<textarea>` bind the same way (`checked="$flag"` on a
checkbox). During a re-run embeds keep their old rows and show “updating…”.

```jsx
<Helmet>
  <Value name="editing" type="boolean" default={false} url={false} />
  <Value name="title" type="string" default="Untitled" url={false} />
  <Value name="drafts" type="table" value={[]} columns={[{"name":"title","type":"string"}]} />
  <Query name="summary">{`select count(*) count from drafts`}</Query>
  <Mutation name="add" reset="title">{`insert into drafts (title) values ($title)`}</Mutation>
</Helmet>

<p>Drafts: <Number data="$summary" col="count" /></p>
{$editing && <p>Editing {$title}</p>}
<Dialog open="$editing">
  <DialogTrigger>Edit</DialogTrigger>
  <DialogContent aria-label="Draft editor" run="$add">
    <Input label="Title" value="$title" required autoFocus />
    <div className="flex justify-end gap-2">
      <DialogClose>Cancel</DialogClose>
      <Button type="submit">Add draft</Button>
    </div>
  </DialogContent>
</Dialog>
```

- `DialogTrigger` sets the bound boolean true; `DialogClose`, Escape or a
  successful submit sets it false and restores focus. A failed Mutation keeps
  the dialog open with the server message. `DialogContent` checks form
  validity first; a `className` on it replaces the default column layout.
  Enter in a text field submits the enclosing `run=` form.
- Every scalar Value travels in the link unless it declares `url={false}`:
  then it is neither written there nor read back. Form fields and
  script-set flags declare it.
- `reset="title amount"` on a Mutation restores those scalars to their
  defaults once the write COMMITS; a refused write changes nothing.
- `set=` on a Button writes values on click, no SQL: `set={{"step": 2}}`, a
  literal, `"$other"`, or in a row `"$_row.<column>"`.

Local SQL is per loaded document: it creates no version and changes no stored
rows. Reload resets inline tables to their declared rows; a `url={false}`
scalar returns to its default. A Query or Mutation over an `<Import>` is a
stored-dataset operation with its normal permissions.
