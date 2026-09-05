---
name: markup-editing
description: >-
  Editable tables: Column templates, guarded writes, tags and references.
order: 2
---
## Read first

Use `<DataTable>` with `<Column>` children to render one template per row.
An existing control with `run="$mutation"` saves its cell through a declared
mutation. Upload a dataset you own with `access: readwrite`
([datasets](publishing-datasets.md)); queries and ordinary controls follow
[data](markup-data.md). No per-row Values or JavaScript required.

## Contents

Example · Scope and identity · Committing · References and authorization.

## Seven roadmap editors

Replace `TASKS_ID` and `SPRINTS_ID` with dataset IDs. The tasks dataset has
`id` (integer), `item`, `owner`, `hours` (nullable number), `depends_on`,
`tags`, `status`, and `sprint`; the sprints dataset has `name`.
Store tags and dependency IDs as **JSON-array strings**, for example
`["design,ux","feature"]` and `["12","19"]`, initially `[]`.
Use `''` for an unscheduled sprint. Migrate legacy comma-separated data
explicitly first; embedded commas cannot be recovered by blindly splitting.

```jsx
<Helmet>
  <title>Editable roadmap</title>
  <Query name="roadmap">{`select * from ref_TASKS_ID order by id`}</Query>
  <Query name="task_options">{`select cast(cast(id as bigint) as varchar) as value, cast(cast(id as bigint) as varchar) || ' · ' || item as label from ref_TASKS_ID order by id`}</Query>
  <Query name="sprint_options">{`select '' as value, 'Unscheduled' as label union all select name as value, name as label from ref_SPRINTS_ID`}</Query>
  <Query name="all_tags">{`select distinct unnest(cast(tags as varchar[])) as tag from ref_TASKS_ID order by tag`}</Query>
  <Mutation name="set_item" expectedAffected={1}>{`update ref_TASKS_ID set item = $_value where id = $_row.id and item is not distinct from $_row.item`}</Mutation>
  <Mutation name="set_owner" expectedAffected={1}>{`update ref_TASKS_ID set owner = $_value where id = $_row.id and owner is not distinct from $_row.owner`}</Mutation>
  <Mutation name="set_hours" expectedAffected={1}>{`update ref_TASKS_ID set hours = $_value where id = $_row.id and hours is not distinct from $_row.hours`}</Mutation>
  <Mutation name="set_depends_on" expectedAffected={1}>{`update ref_TASKS_ID set depends_on = $_value where id = $_row.id and depends_on is not distinct from $_row.depends_on and not list_contains(cast($_value as varchar[]), cast(cast($_row.id as bigint) as varchar))`}</Mutation>
  <Mutation name="set_tags" expectedAffected={1}>{`update ref_TASKS_ID set tags = $_value where id = $_row.id and tags is not distinct from $_row.tags`}</Mutation>
  <Mutation name="set_status" expectedAffected={1}>{`update ref_TASKS_ID set status = $_value where id = $_row.id and status is not distinct from $_row.status`}</Mutation>
  <Mutation name="set_sprint" expectedAffected={1}>{`update ref_TASKS_ID set sprint = $_value where id = $_row.id and sprint is not distinct from $_row.sprint`}</Mutation>
</Helmet>
<DataTable data="$roadmap" rowKey="id">
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
  A Column without a template renders its ordinary formatted value.
- `$_row.field` works in control bindings, `{$_row.field}` text, and string
  templates such as `label="Status {$_row.id}"` inside a Column. One member
  level only; extract nested JSON with SQL. `_`-prefixed declaration names
  are reserved. `$_value` is the committed scalar in mutation SQL.
- A row mutation is invoked only by a control's `run` inside a Column;
  that `run` must name a row mutation. Its `$_row` is the immutable original
  row snapshot from when editing began, not the latest refreshed row.
  Publish checks referenced fields and their types against the bound
  query's result schema. Reusing a mutation requires compatible row schemas.
- Editable tables require `rowKey`, naming a query result column of unique,
  non-null strings or numbers. Numeric `1` and string `"1"` have different
  identities. Preserve source identity in your SQL across sorting, filtering
  and pagination; a loaded window cannot prove global uniqueness. Drafts,
  pending writes and errors survive virtualized rows unmounting.

## Committing and resolving errors

Text and numbers save once on Enter or blur; Escape cancels. Textarea
Shift+Enter inserts a newline. Empty text writes `''`; an empty number writes
`null`, never zero; invalid numbers do not submit. Unchanged edits do not
write. Single Select saves on selection. Multi-select keeps a draft until
Done or outside dismissal (including keyboard focus leaving); Escape cancels.

Multi-select requires `valueFormat="json"` and stores unique strings, with
`[]` for no selections. Commas, quotes and Unicode round-trip through JSON.
`allowCreate` adds values absent from the options. Missing selections remain visible by raw value and removable; options
refreshes never drop them. Malformed JSON or non-string members block editing
instead of replacing the stored value with an empty selection.

A pending cell is disabled; other cells remain editable. Successful values
stay visible until the authoritative query refresh confirms them. Errors
retain the draft for explicit retry or cancellation; refresh does not silently
replace its original snapshot. Captures and static editor previews show
controls disabled; writes require the interactive reader.

Use **both** `expectedAffected={1}` and the original-value predicate shown
above. `IS NOT DISTINCT FROM` compares nulls correctly and checks only the
edited field, allowing different-field edits to coexist. Zero matched rows
returns `row_changed` (stale, deleted, or rejected by a predicate); multiple
matches return `row_not_unique`. Both leave dataset data and version unchanged.
The guard is checked on every storage retry. Publish checks SQL syntax/types;
its empty-table dry run does not enforce the runtime row count. This is
value-based conflict detection: an A→B→A history is not detected.

## References and authorization

Options queries use value/label columns and should include references outside
the currently filtered table. Dependency IDs are strings: this integer-ID
example casts through BIGINT before VARCHAR so `1.0` cannot disagree with
`"1"`. `exclude="$_row.id"` hides the current task from selectable options;
the mutation's server-side predicate is what rejects a self-dependency.
Sprint clearing writes the existing `''` sentinel via the Unscheduled option.

A query filter is **not authorization**: client-supplied row values do not
prove query membership. Put any permitted-subset restriction in the stored
mutation SQL. Dataset access is checked when the mutation runs. Cycle checks
and cross-dataset foreign-key enforcement are deferred; the mutation engine
registers only its target dataset, so the dropdown alone does not enforce
sprint membership or dependency existence.
