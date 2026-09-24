---
name: markup-actions
description: DataTable row action menus and row-scoped buttons.
---
## Row action menus

Put a Popover inside a Column and use a Button with `run="$mutation"`.
The trigger label and action retain `$_row` scope through the nested components;
portaled controls such as Select retain their row context too. A button-only
Column still needs a column in the query result: `'' as action` supplies it.

This runnable example uses temporary local rows. Reload resets them. For saved
tasks, use `source="ref:<datasetId>"` on the Query and Mutation, read/write
`public.rows`, and keep the same row guard and `expectedAffected={1}`.

```jsx
<Helmet>
  <Value name="tasks" type="table" value={[{"id":1,"item":"Review draft","status":"todo"},{"id":2,"item":"Check chart","status":"todo"}]} />
  <Query name="task_rows">{`select *, '' as action from tasks order by id`}</Query>
  <Mutation name="complete_task" expectedAffected={1}>{`
    update tasks set status = 'done'
    where id = $_row.id and status is not distinct from $_row.status
  `}</Mutation>
</Helmet>
<DataTable data="$task_rows" rowKey="id" height="300px">
  <Column col="item" title="Task" />
  <Column col="status" title="Status" />
  <Column col="action" title="Actions">
    <Popover>
      <PopoverTrigger aria-label="Actions for {$_row.item}">Actions</PopoverTrigger>
      <PopoverContent side="left" align="center" className="w-48 p-2">
        <Button run="$complete_task">Complete {$_row.item}</Button>
      </PopoverContent>
    </Popover>
  </Column>
</DataTable>
```

PopoverContent currently renders inline; it is not the Select menu's body portal.
Check an action menu near the edges of its actual scroll container before
shipping. A Button captures the clicked row and reports pending/error state;
it does not supply `$_value`. See [row actions](markup-repeat.md).

