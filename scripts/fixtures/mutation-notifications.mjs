/** Task-server fixture only. Callers publish the returned files through the branch CLI.
 * Account IDs and artifact refs are supplied by the local fixture owner; no credentials here.
 */
export function notificationDemoDataset({assignee, nonmember, pending, left, outsider}) {
 const columns=[{name:'id',type:'number'},{name:'title',type:'string'},{name:'status',type:'string'},{name:'assignee',type:'user'}];
 const rows=[
  {id:1,title:'Review pricing',status:'Todo',assignee},
  {id:2,title:'Ship release notes',status:'Todo',assignee},
  {id:3,title:'Unassigned task',status:'Todo',assignee:null},
  {id:4,title:'Readable nonmember',status:'Todo',assignee:nonmember},
  {id:5,title:'Pending recipient',status:'Todo',assignee:pending},
  {id:6,title:'Former member',status:'Todo',assignee:left},
  {id:7,title:'Restricted recipient',status:'Todo',assignee:outsider},
 ];
 return `<Dataset kind="stored"><Table schema="public" name="rows" columns={${JSON.stringify(columns)}} rows={${JSON.stringify(rows)}} /></Dataset>\n`;
}
export function notificationDemoDocument(datasetId) {
 if(!/^[a-zA-Z0-9_-]+$/.test(datasetId))throw new Error('Expected an artifact ID');
 return `---
title: Mutation notifications demo
template: dashboard
theme: industry
visibility: unlisted
---
<Helmet>
  <Import name="tasks" src="ref:${datasetId}" />
  <Value name="task_id" type="number" default={1} />
  <Value name="status" type="string" default="Done" />
  <Value name="expected_status" type="string" default="Todo" />
  <Value name="scratch" type="table" value={[{"id":1,"value":"initial"}]} />
  <Query name="tasks_list">{\`select *, '' as action from tasks.rows order by id\`}</Query>
  <Query name="scratch_list">{\`select * from scratch\`}</Query>
  <Mutation name="assign_to_me" expectedAffected={1}>{\`update tasks.rows set assignee = $_me.id, status = 'Todo' where id = $task_id\`}</Mutation>
  <Mutation name="change_status" expectedAffected={1}>{\`update tasks.rows set status = $status where id = $task_id and status = $expected_status\`}</Mutation>
  <Mutation name="bulk_status">{\`update tasks.rows set status = $status where status = $expected_status\`}</Mutation>
  <Mutation name="zero_match">{\`update tasks.rows set status = $status where id = $task_id\`}</Mutation>
  <Mutation name="local_edit">{\`update scratch set value = 'changed'\`}</Mutation>
  <Mutation name="repairable" expectedAffected={1}>{\`update tasks.rows set status = $status where id = $task_id\`}</Mutation>
  <Notify name="task_status" on="change_status">{\`select assignee as "to", 'Task ' || title || ' is now ' || status as message from tasks.rows where id = $task_id\`}</Notify>
  {/* The duplicate rule adds no second message/item; the detail is combined. */}
  <Notify name="task_status_copy" on="change_status">{\`select assignee as "to", 'Task ' || title || ' is now ' || status as message from tasks.rows where id = $task_id\`}</Notify>
  <Notify name="task_detail" on="change_status">{\`select assignee as "to", 'Please review ' || title as message from tasks.rows where id = $task_id\`}</Notify>
  <Notify name="bulk_summary" on="bulk_status">{\`select assignee as "to", cast(count(*) as text) || ' tasks are now ' || status as message from tasks.rows where status = $status group by assignee, status\`}</Notify>
  <Notify name="zero_notice" on="zero_match">{\`select assignee as "to", title as message from tasks.rows where id = $task_id\`}</Notify>
  <Notify name="repairable_good" on="repairable">{\`select assignee as "to", 'Updated ' || title as message from tasks.rows where id = $task_id\`}</Notify>
  {/* status='' makes this job fail; repair the current row then retry the job. */}
  <Notify name="repairable_notice" on="repairable">{\`select assignee as "to", status as message from tasks.rows where id = $task_id\`}</Notify>
</Helmet>
<div className="mx-auto max-w-5xl px-6 py-10">
  <h1 className="text-3xl font-semibold">Mutation notifications</h1>
  <p>Choose a task ID, assign it to yourself, then complete it using either completion button. Open the notification bell to see one item containing both messages. Assigning again resets the task to Todo so you can repeat the test.</p>
  <label>Task ID <input aria-label="Task ID" type="number" value="$task_id" min="1" /></label>
  <Button run="$assign_to_me">Assign selected task to me</Button>
  <Select label="New status" value="$status" options={["Todo","Done"]} />
  <Button run="$change_status">Complete selected task</Button>
  <Button run="$bulk_status">Complete matching tasks</Button>
  <DataTable data="$tasks_list" rowKey="id"><Column col="id" /><Column col="title" /><Column col="status" /><Column col="assignee" /><Column col="action"><Button run="$change_status" args={{task_id:"$_row.id",status:"Done",expected_status:"$_row.status"}}>Complete this row</Button></Column></DataTable>
  <h2 className="mt-8 text-xl">Local state</h2>
  <Button run="$local_edit">Change local value</Button>
  <DataTable data="$scratch_list" />
</div>
`;
}
