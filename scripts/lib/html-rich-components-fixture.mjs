/** Synthetic author page. These contracts deliberately use only shipped ESM entries
 * and public element properties; they carry no account identity or remote data. */
export const richFamilies = Object.freeze([
  ['DataTable','data-table','table'],['Markdown','markdown','markdown'],['Mermaid','mermaid','diagram'],
  ['Isometric','isometric','assembly'],['DeckGL','deck-gl','map'],['User','user','person'],
]);
export const richViewports = Object.freeze([{width:800,height:900},{width:390,height:844}]);
export function richFixtureHtml(dark=false) {
 const imports=richFamilies.map(([family,file])=>`import {register${family}} from '/components/${file}.js';register${family}();`).join('\n');
 const markdown='# Field notes\n\nA **rich** report with ~~retired~~ text.\n\n| Region | Count |\n| --- | --- |\n| North | 12 |\n\n```js\nconst count = 12;\n```';
 return `<!doctype html><html data-af-dark="${dark}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 html{font-family:Arial,sans-serif;--background:#fff;--foreground:#182033;--card:#fff;--primary:#2563eb;--muted:#edf1f7;--muted-foreground:#596579;--border:#b8c1cf;color:var(--foreground);background:var(--background);color-scheme:light}html[data-af-dark=true]{--background:#151b29;--foreground:#f1f5fb;--card:#202a3d;--primary:#8bb9ff;--muted:#2b3650;--muted-foreground:#bbc8dd;--border:#59677f;color-scheme:dark}body{margin:0;padding:16px;box-sizing:border-box}main,section{min-width:0;max-width:100%}section{margin-bottom:24px}h1{font-size:22px}h2{font-size:18px}input{max-width:120px;font:inherit;color:inherit;background:var(--background);border:1px solid var(--border)}af-mermaid,af-isometric,af-deck-gl{display:block;min-width:0;max-width:100%}af-mermaid img{max-height:280px}af-user{display:block}.author-note{font-size:12px;color:var(--muted-foreground)}
 </style></head><body><main><h1>Rich component verification</h1>
 ${richFamilies.map(([family,file,id])=>`<section aria-label="${family} fixture"><h2>${family}</h2><af-${file} id="${id}" data-af-id="host-${id}"><aside class="author-note" data-af-id="note-${id}">Authored ${family} note</aside></af-${file}></section>`).join('')}
 </main><script type="module">${imports}
 const table=document.querySelector('#table');table.rowKey='id';table.height=220;
 table.cellRenderers={name(context,cell){if(!cell.querySelector('input')){const input=document.createElement('input');input.setAttribute('aria-label','Name '+context.key);input.value=String(context.row.name);input.addEventListener('change',()=>context.edit(input.value));cell.append(input);}}};
 const columns=[{name:'id',type:'number'},{name:'name',type:'string'},{name:'score',type:'number'}];
 table.data={columns,rows:[{id:1,name:'Alpha',score:30},{id:2,name:'Beta',score:10},{id:3,name:'Gamma',score:20}]};
 document.querySelector('#markdown').source=${JSON.stringify(markdown)};
 document.querySelector('#diagram').code='flowchart LR\\n A[Source] --> B[Result]';
 const assembly=document.querySelector('#assembly');assembly.options={title:'Pump assembly',motion:'instant',parts:[{key:'body',kind:'slab',x:0,y:0,z:0,width:20,depth:12,height:4,separation:[0,0,15]},{key:'shaft',kind:'cylinder',x:10,y:6,z:4,radius:2,height:12,separation:[0,0,25]}]};
 document.querySelector('#map').options={title:'Bundled point map',data:[{longitude:10,latitude:20,value:12},{longitude:11,latitude:21,value:20}],layers:[{'@@type':'ScatterplotLayer',getPosition:'@@=[longitude, latitude]',getRadius:10000,getFillColor:[70,130,240]}],basemap:'none',height:240,tooltip:true,legend:true,initialViewState:{longitude:10,latitude:20,zoom:3}};
 const person=document.querySelector('#person');person.person={id:'synthetic-person',name:'Alex Sample',handle:'alex',image:'/person.svg',profileHref:'#person'};
 window.richFixture={markdownSource:document.querySelector('#markdown').source,columns,originalNotes:[...document.querySelectorAll('[data-af-id]')],tableRows:table.data.rows};
 document.documentElement.dataset.fixtureReady='yes';
 </script></body></html>`;
}
