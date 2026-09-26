---
name: markup-editing
description: >-
  Editable tables: Column templates, guarded writes, tags and references.
order: 2
---
## Read first

Use `<DataTable>` with `<Column>` for row templates. An editor in a Column with
`run="$mutation"` saves its cell: the mutation reads the new value as `$_value`
and the row as `$_row.<column>`. See [data](markup-data.md) for queries and
controls, and [apps](apps.md) for who may write.

[User fields](databases-users.md).

## Contents

Example · Scope and identity · Committing · References and authorization.

## Seven roadmap editors

Replace `rdm123` / `def456` with task/sprint dataset IDs. Tasks have
`id` (integer), `item`, `owner`, `hours` (nullable number), `depends_on`,
`tags`, `status`, and `sprint`; the sprints dataset has `name`.
Store tags/dependencies as **JSON-array strings**: `["design,ux","feature"]`,
`["12","19"]`, initially `[]`. An unscheduled sprint is `''`.
Do not split comma-separated data blindly: embedded commas are ambiguous.

```jsx
<Helmet>
  <title>Editable roadmap</title>
  <Import name="roadmap" src="ref:rdm123" />
  <Import name="sprints" src="ref:def456" />
  <Query name="tasks">{`select * from roadmap.rows order by id`}</Query>
  <Query name="task_options">{`select cast(cast(id as integer) as text) as value, cast(cast(id as integer) as text) || ' · ' || item as label from roadmap.rows order by id`}</Query>
  <Query name="sprint_options">{`select '' as value, 'Unscheduled' as label union all select name as value, name as label from sprints.rows`}</Query>
  <Query name="all_tags">{`select distinct t.value as tag from roadmap.rows, json_each(roadmap.rows.tags) as t order by tag`}</Query>
  <Mutation name="set_item" expectedAffected={1}>{`update roadmap.rows set item = $_value where id = $_row.id and item is not distinct from $_row.item`}</Mutation>
  <Mutation name="set_owner" expectedAffected={1}>{`update roadmap.rows set owner = $_value where id = $_row.id and owner is not distinct from $_row.owner`}</Mutation>
  <Mutation name="set_hours" expectedAffected={1}>{`update roadmap.rows set hours = $_value where id = $_row.id and hours is not distinct from $_row.hours`}</Mutation>
  <Mutation name="set_depends_on" expectedAffected={1}>{`update roadmap.rows set depends_on = $_value where id = $_row.id and depends_on is not distinct from $_row.depends_on and not list_contains($_value, cast(cast($_row.id as integer) as text))`}</Mutation>
  <Mutation name="set_tags" expectedAffected={1}>{`update roadmap.rows set tags = $_value where id = $_row.id and tags is not distinct from $_row.tags`}</Mutation>
  <Mutation name="set_status" expectedAffected={1}>{`update roadmap.rows set status = $_value where id = $_row.id and status is not distinct from $_row.status`}</Mutation>
  <Mutation name="set_sprint" expectedAffected={1}>{`update roadmap.rows set sprint = $_value where id = $_row.id and sprint is not distinct from $_row.sprint and ($_value = '' or $_value in (select name from sprints.rows))`}</Mutation>
</Helmet>
<DataTable data="$tasks" rowKey="id">
  <Column col="id" title="ID" />
  <Column col="item" title="Item">
    <input aria-label="Item {$_row.id}" type="text" value="$_row.item" run="$set_item" />
  </Column>
  <Column col="owner" title="Owner">
    <Select label="Owner {$_row.id}" value="$_row.owner" options={["TBD","@alice","@bob"]} run="$set_owner" />
  </Column>
  <Column col="hours" title="Hours" align="right">
    <input aria-label="Hours {$_row.id}" type="number" min={0} value="$_row.hours" run="$set_hours" />
  </Column>
  <Column col="depends_on" title="Depends on">
    <Select label="Depends on {$_row.id}" multiple valueFormat="json" value="$_row.depends_on" options="$task_options" exclude="$_row.id" run="$set_depends_on" />
  </Column>
  <Column col="tags" title="Tags">
    <Select label="Tags {$_row.id}" multiple allowCreate valueFormat="json" value="$_row.tags" options="$all_tags" run="$set_tags" />
  </Column>
  <Column col="status" title="Status">
    <Select label="Status {$_row.id}" value="$_row.status" options={["backlog","active","done"]} run="$set_status" />
  </Column>
  <Column col="sprint" title="Sprint">
    <Select label="Sprint {$_row.id}" value="$_row.sprint" options="$sprint_options" run="$set_sprint" />
  </Column>
</DataTable>
```

## Scope and identity

- `<Column>` must be a direct DataTable child. Use children **or** the
  `columns={…}` specification, never both. `col`, `title`, `fmt`, `align`,
  `bar`, `colorScale`, `width`, and `kind` use the existing column settings.
  A Column without a template renders its formatted value.
- `$_row.field` works in control bindings, `{$_row.field}` text, and string
  templates such as `label="Status {$_row.id}"` inside a Column. One member
  level only; extract nested JSON with SQL. `_`-prefixed declaration names
  are reserved. `$_value` is the committed value in mutation SQL.
- `run` editors: `<Select>`, `<DatePicker>`, `<input type="text">`,
  `<input type="number">`, `<textarea>`, `<select>` — native tags, not
  `<Input>`; others rejected.
- `<Button run="$complete">` captures `$_row` on click without `$_value`.
  See [action menus](markup-actions.md) for a complete example.
- Row mutations run inside a Column or keyed For. Cell editors capture the row
  when editing begins. Publish validates row fields/types against the query
  result; mutations reused across tables require compatible schemas.
- Editable tables require `rowKey`, naming a query result column of unique,
  non-null strings or numbers. Numeric `1` and string `"1"` have different
  identities. Preserve source identity in your SQL across sorting, filtering
  and pagination; a loaded window cannot prove global uniqueness. Drafts,
  pending writes and errors survive virtualized rows unmounting.

## Committing and resolving errors

Text and numbers save once on Enter or blur; Escape cancels. Textarea
Shift+Enter inserts a newline. Empty text writes `''`; an empty number writes
`null`, never zero; invalid numbers do not submit. Unchanged edits do not
write. Single Select and DatePicker save on selection. Multi-select keeps a draft until
Done or outside dismissal (including keyboard focus leaving); Escape cancels.

Select children render as footer actions; clicking cancels the cell draft.
For “Add Sprint…”, use a native button to open an author-script dialog,
create with `mx.mutate`, then select the refreshed option.

Multi-select requires `valueFormat="json"` and stores unique strings, with
`[]` for no selections. Commas, quotes and Unicode round-trip through JSON.
`allowCreate` adds values absent from the options. Missing selections remain visible by raw value and removable; options
refreshes never drop them. Malformed JSON or non-string members block editing without erasing data.

Pending cells are disabled. Saved values stay visible until refresh;
errors retain drafts and original snapshots. Captures and static previews disable editors.

Use **both** `expectedAffected={1}` and the original-value predicate
above. `IS NOT DISTINCT FROM` compares nulls correctly and checks only the
edited field, allowing different-field edits to coexist. Zero matched rows
returns `row_changed` (stale, deleted, or rejected by a predicate); multiple
matches return `row_not_unique`. Both leave dataset data and version unchanged.
The guard runs on every retry. Publish checks SQL syntax/types,
not the runtime row count. It is
value-based conflict detection: an A→B→A history is not detected.

## References and authorization

Options queries use value/label columns beyond the current filter.
Integer dependency IDs cast through integer to text to match JSON strings.
`exclude="$_row.id"` hides self-options; the server predicate rejects self-writes.
Unscheduled writes the existing `''` sprint sentinel.

A query filter is **not authorization**: client-supplied row values do not
prove query membership. Put any permitted-subset restriction in the
mutation SQL, as `set_sprint` does: a mutation may read other imports (not
queries), so it checks the sprint exists. Denied controls disable. Cycle checks
are yours to write; the dropdown alone enforces nothing.
