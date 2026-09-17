---
name: databases-users
description: Native user fields, membership constraints, current identity and metadata-driven controls.
---

## User fields

`user` is a nullable account ID, displayed by name in DataTable. Declare identity
columns in a stored dataset. This complete example covers publishing, filtering,
editable titles, assignment and completion. Adapt the two dataset files and the
report below, then push them in order.

Save this resource as `people.yaml`:

```yaml
type: dataset
title: Team tasks
source: people.jsx
access: readwrite
```

Save the definition below as `people.jsx`. The Dataset definition belongs in
this file, separate from your report's JSX:


```jsx
<Dataset kind="stored">
  <Table schema="public" name="rows"
    columns={[
      {"name":"id","type":"number"},
      {"name":"task","type":"string"},
      {"name":"assigned_to","type":"user","constraints":{"memberOf":["current"]}},
      {"name":"completed_by","type":"user","constraints":{"self":true}}
    ]}
    rows={[{"id":1,"task":"Review proposal","assigned_to":null,"completed_by":null}]} />
</Dataset>
```

Publish the YAML resource (the CLI reads its JSX source):

```sh
afbin push people.yaml --yes --json
```

Use the returned dataset ID in place of `tsk123` in the report below. Keep the
identity fields in an existing report's YAML fence when editing it; publish the
report with `afbin push report.jsx --yes --json`. CSV infers ordinary columns;
the Dataset definition above declares native user types and constraints.

`memberOf` is always a nonempty array of unique references. Membership in ANY
listed document is sufficient; other constraints combine with AND. Eligible
members are its owner and registered users explicitly shared on it, including
registered accounts matching pending invitations. Public-link visitors are not
members. Omission permits any valid account ID but does not expose a global user
search. `self: true` permits only the logged-in user's ID when that field is
written; unrelated edits do not revalidate historical identity fields. Null
means unset. All actual non-null writes, including SQL expressions and whole
replacement imports, are checked on the server.

`"current"` binds once when the dataset is first referenced by a report owned by
its owner. The server stores that report's concrete reference. Until then the
field must remain null. Reusing the dataset in another report never rebinds it.
Use `"ref:<reportId>"` when the report already exists. Membership follows the
fixed report's current share list. The picker only lists scopes its viewer can
read.

Every `Column col` must name a query result column, including a button-only
column. Keep `select *, '' as action` below: `select *` alone omits `action` and
publish will reject `<Column col="action">`. The alias is a display column in
the query result; it needs no stored dataset field.

```jsx
<Helmet>
  <Value name="person" source="ref:tsk123" column="assigned_to" />
  <Query name="tasks" source="ref:tsk123">{`
    select *, '' as action from public.rows
    where $person is null or assigned_to=$person order by id
  `}</Query>
  <Mutation name="rename" source="ref:tsk123" expectedAffected={1}>{`
    update public.rows set task=$_value where id=$_row.id
  `}</Mutation>
  <Mutation name="assign" source="ref:tsk123" expectedAffected={1}>{`
    update public.rows set assigned_to=$_value where id=$_row.id
  `}</Mutation>
  <Mutation name="complete" source="ref:tsk123" expectedAffected={1}>{`
    update public.rows set completed_by=$_me where id=$_row.id
  `}</Mutation>
</Helmet>
<Select label="Person filter" value="$person" />
<DataTable data="$tasks" rowKey="id">
  <Column col="task"><input aria-label="Task title" value="$_row.task" run="$rename" /></Column>
  <Column col="assigned_to"><Select label="Assign task" value="$_row.assigned_to" run="$assign" /></Column>
  <Column col="completed_by" />
  <Column col="action"><Button run="$complete">Complete</Button></Column>
</DataTable>
```

The standalone Value inherits its user type and constraints from `public.rows`'s
named column. Names such as `person` and `assign` are author-chosen. User Selects
get searchable choices from field metadata; no `options` query is needed.
Direct SQL projections, aliases, filters and ordering preserve user metadata;
computed text such as `upper(assigned_to)` is ordinary text. `$_me` is reserved
and bound by the server to the actual caller, never a client-supplied Value or
the report owner. Mutations using it require login. In queries it is null for
anonymous readers. PostgreSQL catalogs remain read-only.

## Who is reading

`$_me` is the reader's account ID and `null` for a guest. Read it in any
condition or reactive expression; it is never declared, never bindable
(`value="$_me"`, `open="$_me"` and `<Value name="_me">` are rejected at publish)
and never carried in the link.

```jsx
{$_me && <Button run="$claim">Claim this</Button>}
{!$_me && <SignIn>Sign in to claim one</SignIn>}
```

`<User id=… />` shows a person by display name. `id` takes a literal account ID,
`$_me`, a scalar `user` Value, or a row field inside `<For>`/`<Column>`. Add
`avatar` for an initial avatar and `fallback` for what an unset field reads as;
an ID this reader cannot see renders "Unknown person", never the raw ID.

```jsx
<p>Signed in as <User id="$_me" avatar /></p>
<Column col="paid_by"><User id="$_row.paid_by" fallback="nobody" /></Column>
```

`$_row.<field>` only resolves inside a `<For>` or a `<Column>`; written anywhere
else it is an ordinary string and renders "Unknown person".

`<SignIn>` is a button-styled link to login that returns to this address. It
renders nothing for a signed-in reader, so it needs no condition of its own.

```jsx
<SignIn />
<SignIn className="w-full">Join to add an expense</SignIn>
```

A `<Mutation>` binding `$_me` needs a signed-in reader. A guest's `<Button run>`
or `<DialogContent run>` then offers "Sign in to do this" instead of running,
and a direct POST answers `403 {"error":"policy_denied","code":"sign_in_required"}`.
