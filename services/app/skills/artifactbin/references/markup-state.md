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

Native controls bind scalars too: `<select value="$region" options="$regions" />`,
`<input type="range|number|text|date" value="$x" />`, `checked="$flag"` on a
checkbox, and `<textarea value="$note" />`. During a query re-run embeds keep
their old rows and show “updating…”; failures show the engine message.

```jsx
<Helmet>
  <Value name="editing" type="boolean" default={false} />
  <Value name="title" type="string" default="Untitled" />
  <Value name="drafts" type="table" value={[]} columns={[{"name":"title","type":"string"}]} />
  <Query name="summary">{`select count(*) count from drafts`}</Query>
  <Mutation name="add">{`insert into drafts (title) values ($title)`}</Mutation>
</Helmet>

<p>Drafts: <Number data="$summary" col="count" /></p>
{$editing && <p>Editing {$title}</p>}
<Dialog open="$editing">
  <DialogTrigger>Edit</DialogTrigger>
  <DialogContent aria-label="Draft editor" run="$add">
    <input aria-label="Title" value="$title" required autoFocus />
    <button type="submit">Add draft</button>
    <DialogClose>Cancel</DialogClose>
  </DialogContent>
</Dialog>
```

`DialogTrigger` sets the bound boolean true. `DialogClose`, Escape, or a
successful submit sets it false and restores focus to the trigger. A failed
Mutation leaves the dialog open and shows the server message. `DialogContent`
uses normal form validity before running its Mutation.

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
non-default scalar choices written into the URL persist. A Query or Mutation
with `source="ref:abc123"` remains a stored-dataset operation with its normal
read and write permissions; local state does not weaken that boundary.
