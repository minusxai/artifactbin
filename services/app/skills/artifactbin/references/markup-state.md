---
name: markup-state
description: >-
  Explains local state.
order: 2
---
## Read first

Use scalar Values for choices and flags, inline table Values for temporary
rows, and Queries to derive the view. Conditions are safe structural JSX, not
JavaScript: they can read declared scalars but cannot call functions or run
event handlers.

Type into the kit's text fields — `<Input label="Title" value="$title" />`
(`type="text|number|email|url|search|password"`, `placeholder`, `min`, `max`,
`step`, `required`) and `<Textarea label="Note" value="$note" rows={3} />` —
beside `Select`, `Segmented`, `Slider`, `DatePicker` and `Switch`; all of them
share one frame. Native `<input>`/`<select>`/`<textarea>` still bind the same way
(`checked="$flag"` on a checkbox) and are themed now too. During a query re-run
embeds keep their old rows and show “updating…”; failures show the engine message.

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

`DialogTrigger` sets the bound boolean true. `DialogClose`, Escape, or a
successful submit sets it false and restores focus to the trigger. A failed
Mutation leaves the dialog open and shows the server message. `DialogContent`
uses normal form validity before running its Mutation. The dialog is styled by
default and stacks its children in a column; a `className` on `DialogContent`
replaces that layout with yours. `DialogTrigger` draws a button and `DialogClose`
an outlined one unless you style them. `Select` and `DatePicker` open inside it.
Enter in a text field submits the enclosing `run=` form.

Every scalar Value travels in the link unless it says otherwise, so a form field
and a script-set flag declare `url={false}`: it stays out of the address in both
directions — not written there, not read back from a shared or stale one.
`reset="title amount"` on the Mutation puts those scalars back to their declared
defaults once the write is COMMITTED, which is how the box empties itself for
the next entry; a refused write changes nothing the person typed.

For scalar-only state, update the implicit one-row `_signals` table:

```jsx
<Helmet>
  <Value name="step" type="number" default={0} />
  <Mutation name="next">{`update _signals set step=step+1`}</Mutation>
</Helmet>
<Button run="$next">Next</Button>
{$step > 0 ? <p>Step {$step}</p> : <p>Not started</p>}
```

Local SQL is intentionally ephemeral and per loaded document. It does not
create a source version, alter stored dataset rows, or change permissions.
Reload resets `_signals` and inline table rows to their declared defaults;
non-default scalar choices written into the URL persist, and a `url={false}`
scalar comes back at its default because it was never in the address. A Query or Mutation
with `source="ref:abc123"` remains a stored-dataset operation with its normal
read and write permissions; local state does not weaken that boundary.
