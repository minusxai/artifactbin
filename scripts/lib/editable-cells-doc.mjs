/**
 * EDITABLE DATATABLE CELLS as a published document, for the compiled-parity gate: every editing cell today's
 * reader draws (StoryRuntimeApp RuntimeCellControl — a Select, a multiple Select, a DatePicker, native
 * input/number/textarea/select cells) plus a row action and a templated cell, over a readwrite dataset.
 * The same document the unit ground truth was captured from (services/app/lib/islands/__tests__/fixtures/
 * editable-cells.ts).
 *
 * `publish(body) → { id }` is the caller's door (a bearer `POST /api/artifacts`), so the dataset belongs to
 * whoever publishes the document. A reader the gate opens is a guest: every write is refused, and the cells
 * are drawn disabled with the reason on them.
 */
export async function publishEditableCells(publish, visibility = 'unlisted') {
  const rows = [
    { id: 1, item: 'Alpha', hours: 2, note: 'n1', status: 'backlog', tags: '["feature"]', due: '2026-01-02' },
    { id: 2, item: 'Beta', hours: 3, note: 'n2', status: 'active', tags: '[]', due: null },
  ];
  const dataset = await publish({ title: 'Editable cells rows', dataset: rows, access: 'readwrite', visibility });
  const fields = ['item', 'hours', 'note', 'status', 'tags', 'due'];
  const mutations = fields.map((f) => `<Mutation name="set_${f}" expectedAffected={1}>{\`update t.rows set ${f}=$_value where id=$_row.id\`}</Mutation>`).join('\n');
  const markup = `<Helmet><Import name="t" src="ref:${dataset.id}" /><Query name="rows">{\`select *, status as pick, '' as action, '' as label from t.rows order by id\`}</Query>
${mutations}
<Mutation name="set_pick" expectedAffected={1}>{\`update t.rows set status=$_value where id=$_row.id\`}</Mutation>
<Mutation name="complete" expectedAffected={1}>{\`update t.rows set status='done' where id=$_row.id\`}</Mutation></Helmet>
<div className="p-4">
<DataTable id="tbl" data="$rows" rowKey="id" height={400}>
<Column col="id" title="ID" />
<Column col="item" title="Item"><input aria-label="Item {$_row.id}" type="text" value="$_row.item" run="$set_item" /></Column>
<Column col="hours" title="Hours"><input type="number" min={0} value="$_row.hours" run="$set_hours" /></Column>
<Column col="note" title="Note"><textarea value="$_row.note" run="$set_note" /></Column>
<Column col="status" title="Status"><Select label="Status {$_row.id}" value="$_row.status" options={["backlog","active","done"]} run="$set_status" /></Column>
<Column col="pick" title="Pick"><select value="$_row.pick" run="$set_pick"><option value="backlog">backlog</option><option value="active">active</option><option value="done">done</option></select></Column>
<Column col="tags" title="Tags"><Select label="Tags {$_row.id}" multiple allowCreate valueFormat="json" value="$_row.tags" options={["feature","ux"]} run="$set_tags" /></Column>
<Column col="due" title="Due"><DatePicker label="Due {$_row.id}" value="$_row.due" run="$set_due" /></Column>
<Column col="action" title="Action"><Button run="$complete" aria-label="Complete {$_row.id}">Done</Button></Column>
<Column col="label" title="Label"><span id="lbl" className="font-bold" aria-describedby="lbl">{$_row.item}</span> text {$_row.hours}</Column>
</DataTable>
<DataTable data="$rows" rowKey="id"><Column col="id" /><Column col="status"><Button run="$complete">Done</Button><Select label="S" value="$_row.status" options={["a"]} run="$set_status" /></Column></DataTable>
</div>`;
  return publish({ title: 'Editable cells', markup, visibility });
}
