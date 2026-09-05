/** The same disposable roadmap drives the browser gate and a local review link. */
import { startDocument } from './start-doc.mjs';

export async function createEditableTableFixture(base, count = 500, source = {}) {
  const seed = await startDocument(base);
  const headers = { Authorization: `Bearer ${seed.token}`, 'Content-Type': 'application/json' };
  const api = async (path, body, method = 'POST') => {
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  const rows = source.rows ?? Array.from({ length: count }, (_, i) => ({ id: i + 1, item: `Task ${i + 1}`, owner: 'TBD', hours: 2, depends_on: '[]', tags: '[]', status: 'backlog', sprint: '' }));
  const dataset = await api('/api/artifacts', { title: 'Editable roadmap gate data', dataset: rows, access: 'readwrite', visibility: 'unlisted' });
  const sprints = await api('/api/artifacts', { title: 'Editable roadmap gate sprints', dataset: source.sprints ?? [{ name: 'Sprint 1' }, { name: 'Sprint 2' }], access: 'readwrite', visibility: 'unlisted' });
  const fields = ['item', 'owner', 'hours', 'depends_on', 'tags', 'status', 'sprint'];
  const mutations = fields.map(field => `<Mutation name="set_${field}" expectedAffected={1}>{\`update ref_${dataset.id} set ${field}=$_value where id=$_row.id and ${field} is not distinct from $_row.${field}${field === 'depends_on' ? ' and not list_contains(cast($_value as varchar[]), cast(cast($_row.id as bigint) as varchar))' : ''}\`}</Mutation>`).join('\n');
  const markup = `<Helmet><title>Editable roadmap review</title>
<Value name="filter_status" type="string" />
<Query name="tasks">{\`select * from ref_${dataset.id} where $filter_status is null or status=$filter_status order by id\`}</Query>
<Query name="task_options">{\`select cast(cast(id as bigint) as varchar) as value, item as label from ref_${dataset.id} order by id\`}</Query>
<Query name="sprints">{\`select '' as value, 'Unscheduled' as label union all select name, name from ref_${sprints.id}\`}</Query>
${mutations}</Helmet>
<div data-design="tw" className="p-6"><h1 className="text-2xl font-semibold">Editable roadmap review</h1>
<Select label="Filter status" value="$filter_status" options={["backlog","active","done"]} />
<DataTable data="$tasks" rowKey="id" height={320}>
<Column col="id" title="ID" />
<Column col="item" title="Item"><input aria-label="Item {$_row.id}" type="text" value="$_row.item" run="$set_item" /></Column>
<Column col="owner" title="Owner"><Select label="Owner {$_row.id}" value="$_row.owner" options={["TBD","@vivek","@ppsreejith"]} run="$set_owner" /></Column>
<Column col="hours" title="Hours"><input aria-label="Hours {$_row.id}" type="number" min={0} value="$_row.hours" run="$set_hours" /></Column>
<Column col="depends_on" title="Depends on"><Select label="Depends on {$_row.id}" multiple valueFormat="json" value="$_row.depends_on" options="$task_options" run="$set_depends_on" /></Column>
<Column col="tags" title="Tags"><Select label="Tags {$_row.id}" multiple allowCreate valueFormat="json" value="$_row.tags" options={["feature","design,ux"]} run="$set_tags" /></Column>
<Column col="status" title="Status"><Select label="Status {$_row.id}" value="$_row.status" options={["backlog","active","done"]} run="$set_status" /></Column>
<Column col="sprint" title="Sprint"><Select label="Sprint {$_row.id}" value="$_row.sprint" options="$sprints" run="$set_sprint" /></Column>
</DataTable></div>`;
  await api(`/api/artifacts/${seed.id}`, { title: 'Editable roadmap review', markup }, 'PUT');
  return { id: seed.id, datasetId: dataset.id, sprintsId: sprints.id, markup, url: `${base}/a/${seed.id}`, api, token: seed.token };
}
