/** Real author-owned Vega examples; no platform chart component or runtime globals. */
export function datavizExamples(reference){
 const examples=[...reference.matchAll(/```json\n([^`]+)```/g)].map(match=>JSON.parse(match[1]));
 if(examples.length!==2||!examples[0].encoding||!Array.isArray(examples[1].data))throw Error('Expected two shipped dataviz grammars');
 return {lite:examples[0],vega:examples[1]};
}
/** Browser function is serialized verbatim into the normal published fixture.
 * Runtime objects/observer lifetimes are transient chart resources.
 * @returns {Promise<import('./native-dataviz-contract').NativeDatavizController>}
 */
export async function mountNativeDataviz(examples,ports){
 const hosts=['lite-chart','vega-chart'].map(id=>ports.document.getElementById(id));
 let views=[],themeKey,disposed=false,pending=Promise.resolve(),nativeRows=examples.vega.data.find(entry=>entry.name==='rows')?.values||[];
 const enqueue=task=>{const result=pending.then(task,task);pending=result;return result;};
 const finalize=()=>{for(const view of views)view.finalize();views=[];};
 const render=async()=>{
  if(disposed)return;
  const theme=ports.theme(),widths=hosts.map(host=>Math.max(100,Math.floor(ports.measure(host))));
  if(themeKey!==theme.key||!views.length){
   finalize();for(const host of hosts)host.replaceChildren();
   const config={background:'transparent',numberFormat:'.3~s',axis:{labelColor:theme.label,titleColor:theme.label,labelFontSize:11,titleFontSize:12,titleFontWeight:'normal',gridColor:theme.grid,gridDash:[3,3]},legend:{orient:'top',labelColor:theme.label},line:{strokeWidth:2},point:{filled:true,size:25},bar:{cornerRadiusEnd:2}};
   const specs=[ports.compile({...examples.lite,width:widths[0],config}).spec,{...examples.vega,data:examples.vega.data.map(entry=>entry.name==='rows'?{...entry,values:nativeRows}:entry),width:widths[1]}];
   views=specs.map((spec,index)=>new ports.vega.View(ports.vega.parse(spec,index===1?config:undefined,{ast:true}),{container:hosts[index],renderer:'svg',expr:ports.vega.expressionInterpreter}));
   themeKey=theme.key;
  }
  await Promise.all(views.map((view,index)=>view.width(widths[index]).resize().runAsync()));
 };
 const refresh=()=>enqueue(render);
 const observedRefresh=()=>{const result=refresh();result.catch(error=>ports.reportError?.(error));return result;};
 const stopResize=ports.observeResize(ports.document.getElementById('chart-layout')||hosts[0],observedRefresh);
 const stopTheme=ports.observeTheme(observedRefresh);
 await refresh();
 return {refresh,async updateNativeRows(rows){
  await enqueue(async()=>{
   if(disposed)throw Error('Chart controller disposed');
   try{await views[1].data('rows',rows).runAsync();}catch(error){views[1].data('rows',nativeRows);throw error;}nativeRows=rows.map(row=>({...row}));
   const body=ports.document.getElementById('native-rows');body.replaceChildren();
   for(const row of views[1].data('rows')){const tr=ports.document.createElement('tr');for(const value of [row.category,row.count]){const td=ports.document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}
  });
 },dispose(){if(disposed)return;disposed=true;stopResize();stopTheme();finalize();for(const host of hosts)host.replaceChildren();}};
}
/** @param {import('./native-dataviz-contract').NativeDatavizExamples} examples */
export function nativeDatavizFixture(examples,origin='http://localhost:3030'){
 const local=new URL(origin).origin;
 const rows=examples.lite.data.values.map(row=>`<tr><td>${row.category}</td><td>${row.count}</td></tr>`).join('');
 return `<!doctype html><html data-af-dark="false"><head><title>Native dataviz acceptance</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' data: blob: ${local}/libraries/ ${local}/af/v1/; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"> <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>
html{--chart-label:#57606a;--chart-grid:#d0d7de;background:#fff;color:#17202b}html[data-af-dark="true"]{--chart-label:#c9d1d9;--chart-grid:#30363d;background:#0d1117;color:#f0f6fc}body{font:14px system-ui;margin:16px}#chart-layout{width:min(100%,560px)}.chart{width:100%;min-height:220px}table{border-collapse:collapse}td,th{padding:4px 8px;text-align:left}
</style><script src="/af/v1/core.js"></script></head><body><h1>Completed tasks by category</h1>
<div id="chart-layout"><h2>Vega-Lite</h2><div id="lite-chart" class="chart" role="img" aria-label="Vega-Lite completed tasks by category"></div><table aria-label="Vega-Lite exact values"><thead><tr><th>Category</th><th>Completed tasks</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Vega</h2><div id="vega-chart" class="chart" role="img" aria-label="Vega completed tasks by category"></div><table aria-label="Vega exact values"><thead><tr><th>Category</th><th>Completed tasks</th></tr></thead><tbody id="native-rows">${rows}</tbody></table></div>
<button id="update-chart" disabled>Update native data</button><button id="remove-charts" disabled>Remove charts</button><output id="chart-error"></output>
<script type="module">
import * as vega from "/libraries/vega-6.3.1/index.js";
import {compile} from "/libraries/vega-lite-6.4.3/index.js";
const mount=${mountNativeDataviz.toString()};
const controller=await mount(${JSON.stringify(examples).replaceAll('<','\\u003c')},{document,vega,compile,
 measure:host=>host.clientWidth-48,
 theme:()=>{const style=getComputedStyle(document.documentElement);return {key:document.documentElement.getAttribute('data-af-dark'),label:style.getPropertyValue('--chart-label').trim(),grid:style.getPropertyValue('--chart-grid').trim()};},
 observeResize:(host,refresh)=>{const observer=new ResizeObserver(refresh);observer.observe(host);return()=>observer.disconnect();},
 observeTheme:refresh=>{const observer=new MutationObserver(refresh);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-af-dark','data-af-design-system','class','style']});return()=>observer.disconnect();},
 reportError:error=>{document.querySelector('#chart-error').textContent=error.message;reportError(error);}
});
const update=document.querySelector('#update-chart'),remove=document.querySelector('#remove-charts');update.disabled=false;remove.disabled=false;
update.onclick=()=>controller.updateNativeRows([{category:'Updated',count:7}]).catch(reportError);
const dispose=()=>{controller.dispose();update.disabled=true;remove.disabled=true;update.onclick=null;remove.onclick=null;window.removeEventListener('pagehide',dispose);};remove.onclick=dispose;window.addEventListener('pagehide',dispose,{once:true});
</script></body></html>`;
}
