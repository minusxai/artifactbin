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
