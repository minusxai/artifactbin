---
name: markup-actions
description: DataTable row action menus and row-scoped buttons.
---
## Read first

A Popover inside a Column holds `<Button run="$mutation">`; `$_row` scope
survives the nesting. A button-only Column still needs a query column:
`'' as action`.

## Row action menus

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

PopoverContent renders inline, not portaled: check it near the edges of its
scroll container. For saved rows, write `tasks_data.rows` from an `<Import>`.
See [row actions](markup-repeat.md).
