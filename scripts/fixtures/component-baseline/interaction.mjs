/** Authored interaction pairs: the old side is rendered only by its actual compiler. */
const revision='8eaac63810b66eb575b018be89bb63443e1b7aaf';
const click=(role,name)=>({action:'click',role,name});
const press=(role,name,key)=>({action:'press',role,name,key});
const open=click('button','Person');
const choose=click('option','Grace');
const selected=(open=false)=>({roles:[{role:'button',name:'Person',expanded:open,...(!open?{focused:true}:{})},...(open?[{role:'option',name:'Grace',selected:true},{role:'option',name:'Ada',selected:false}]:[])],textIncludes:['Grace'],...(!open?{rolesAbsent:[{role:'listbox',name:'Person'}],hiddenText:['Linus']}:{})});
const data=[{name:'Ada',score:92},{name:'Grace',score:98},{name:'Linus',score:85}];
const body=rows=>rows.map(row=>[row.name,String(row.score)]);
/** @type {import('./interaction-contract').InteractionParityFixture[]} */
export const interactionBaselineFixtures=[
  {
    id:'select-choice',family:'Select',modules:['select'],
    provenance:{revision,files:['services/app/lib/islands/kit/select.tsx','services/app/lib/islands/kit/select-popup.tsx'],facts:['choose writes the declared Value, closes the single-select popup and focuses the trigger','Search ArrowDown/Enter chooses the highlighted option','Opening again reads the changed Value']},
    oldJsx:'<Helmet><Value name="person" type="string" default="Ada" /></Helmet><Select label="Person" value="$person" options={["Ada","Grace","Linus"]} />',
    newHtml:'<af-select label="Person"></af-select>',
    setup:'const field=document.querySelector("af-select");field.options=["Ada","Grace","Linus"];field.value="Ada";field.addEventListener("af-change",event=>{field.value=event.detail.value});',
    states:[
      {id:'chosen',actions:[open,choose],expected:selected()},
      {id:'reopened',actions:[open,choose,open],expected:selected(true)},
      {id:'keyboard-chosen',actions:[open,press('searchbox','Search Person','ArrowDown'),press('searchbox','Search Person','ArrowDown'),press('searchbox','Search Person','Enter')],expected:selected()},
    ],
    limitations:['Verifies viewer-local selection during this reader visit; persistence across reload is a separate platform-state contract.'],
  },
  {
    id:'data-table-sort-cycle',family:'DataTable',modules:['data-table'],
    provenance:{revision,files:['services/app/lib/islands/kit/data.tsx','services/app/lib/story-ui/data-table.ts'],facts:['DataGrid cycle toggles ascending, descending, then no sort','Native header aria-sort exposes the current direction','Local rows are stably ordered by sortRows; clearing restores authored order']},
    oldJsx:'<Helmet><Query name="people">{`select \'Ada\' as name, 92 as score union all select \'Grace\', 98 union all select \'Linus\', 85`}</Query></Helmet><DataTable data="$people" />',
    newHtml:'<af-data-table></af-data-table>',
    setup:`document.querySelector("af-data-table").data=${JSON.stringify({columns:[{name:'name',type:'string'},{name:'score',type:'number'}],rows:data})};`,
    states:[
      {id:'ascending',actions:[click('columnheader','Sort by score')],expected:{roles:[{role:'columnheader',name:'Sort by score',sort:'ascending'}],bodyRows:body([data[2],data[0],data[1]])}},
      {id:'descending',actions:[click('columnheader','Sort by score'),click('columnheader','Sort by score')],expected:{roles:[{role:'columnheader',name:'Sort by score',sort:'descending'}],bodyRows:body([data[1],data[0],data[2]])}},
      {id:'cleared',actions:[click('columnheader','Sort by score'),click('columnheader','Sort by score'),click('columnheader','Sort by score')],expected:{roles:[{role:'columnheader',name:'Sort by score',sort:'none'}],bodyRows:body(data)}},
    ],
    limitations:['Local sort cycle only; remote paging, query transport and virtualization require a separate >1000-row paired fixture.'],
  },
];

// The original default result window is DISPLAY_ROWS=1000. This is an authored
// data source, not an intercepted network response or fabricated rendered state.
export const interactionPagingSql='with recursive seq(id) as (select 1 union all select id+1 from seq where id<1001) select id from seq order by id';
interactionBaselineFixtures.push({
  id:'data-table-load-more',family:'DataTable',modules:['data-table'],
  provenance:{revision,files:['services/contracts/src/sql.ts','services/app/lib/islands/kit/data.tsx'],facts:['The original display window is1000 rows','Load more reads an actual500-row page and appends its rows','Virtual scrolling mounts the final loaded row when scrolled to the bottom']},
  oldJsx:`<Helmet><Query name="sequence">{\`${interactionPagingSql}\`}</Query></Helmet><DataTable data="$sequence" rowKey="id" height={360} columns={[{col:"id",fmt:"d"}]} />`,
  newHtml:'<div id="table-mount"></div>',
  setup:`const table=document.createElement("af-data-table");const rows=Array.from({length:1001},(_,i)=>({id:i+1}));const columns=[{name:"id",type:"number"}];table.columns=[{col:"id",fmt:"d"}];table.setAttribute("row-key","id");table.setAttribute("height","360");table.source={async read({offset,limit,sort,signal}){if(signal.aborted)throw new DOMException("Aborted","AbortError");const ordered=sort?.dir==="desc"?[...rows].reverse():rows;return {columns,rows:ordered.slice(offset,offset+limit),totalRows:rows.length,truncated:offset+limit<rows.length};}};table.data={columns,rows:rows.slice(0,1000),totalRows:1001,truncated:true};document.querySelector("#table-mount").append(table);`,
  states:[
    {id:'initial',actions:[],expected:{roles:[{role:'button',name:'Load more rows',disabled:false}]}},
    {id:'loaded-end',actions:[click('button','Load more rows'),{action:'scroll',role:'table',name:''}],expected:{bodyRowsInclude:[['1001']]}},
  ],
  limitations:['Original Query uses the real SQLite paging transport; native HTML uses its public caller-owned TableSource over the identical authored sequence. This proves component paging and virtualization, not backend authorization.','Original retains its footer after completion; native HTML removes its completed footer. Raw copy and controls are retained rather than normalized.'],
});
/** Gate afterAction hook: wait for real transport completion before scrolling,
 * then for the real virtual window to mount its appended final row. */
export async function settleInteraction({fixture,action,frame,implementation}){
  if(fixture.id!=='data-table-load-more')return;
  if(action.action==='click')await frame.waitForFunction(implementation==='jsx'
    ?()=>document.body.innerText.includes('1,001 of 1,001 rows')
    :()=>document.querySelector('af-data-table')?.data.rows.length===1001);
  if(action.action==='scroll')await frame.waitForFunction(()=>[...document.querySelectorAll('tbody tr')].some(row=>row.querySelector('td')?.textContent?.trim()==='1001'));
}
