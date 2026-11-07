/**
 * Example: the renderer of examples/csv-dashboard.html. It reads window.DATA, asks every DATA
 *   query through _sql in one watched request, and draws the stats, the Vega-Lite charts, the
 *   deck.gl map, a value table per chart and the filters that link them. A file of its own so
 *   the page stays short enough to read whole.
 * Usage: keep it next to index.html as csv-dashboard.mjs (new-page.mjs copies it); index.html
 *   loads it with <script type="module" src="./csv-dashboard.mjs">. Change DATA, not this file.
 * Gotchas: a chart's mark is bar, line, point, rect (a heatmap) or map; series with multiples:true
 *   draws one small panel per series value on a shared scale. Picking a filter reruns every
 *   query with its $param set; a late answer for an older pick is dropped. A map names only
 *   the places whose names fit; every dot keeps its tooltip and the table lists them all.
 */
import {client,gql} from '@afbin/apollo';
import * as vega from '@afbin/vega';
import {compile} from '@afbin/vega-lite';
const D=window.DATA,$=s=>document.querySelector(s),status=$('#status'),names=Object.keys(D.queries);
const label=col=>D.labels[col]??col,filters=D.filters??{};
// Each filter is a _sql parameter: null shows every row; a picked value narrows the queries that
// read it. gql also takes a one-string array: one request, each DATA query an aliased _sql field
// whose SQL and parameters travel as variables (never spliced into the document).
const picked=Object.fromEntries(Object.keys(filters).map(key=>[key,null]));
const pageQuery=gql([`query Page($p:JSON,${names.map((_,i)=>`$s${i}:String!`).join(',')}){`+
  names.map((name,i)=>`${name}:_sql(sql:$s${i},params:$p){rows}`).join(' ')+'}']);
const sqls=Object.fromEntries(names.map((name,i)=>[`s${i}`,D.queries[name]]));
let answers={},views=[],watch,round=0,width=0,drawn=Promise.resolve(),pending=false;
const fmt=(n,digits=0)=>Number.isFinite(n)?n.toLocaleString(undefined,{minimumFractionDigits:digits,
  maximumFractionDigits:digits}):'–';
// What every text reads: a query's rows as SQL answered them.
const helpers={rows:name=>answers[name]??[],one:name=>answers[name]?.[0]??{},fmt};
// One value per row of the chart's query; the chart and its table share them.
const values=c=>helpers.rows(c.query).filter(row=>Number.isFinite(row[c.y])&&(c.mark!=='point'||
  Number.isFinite(row[c.x]))).map(row=>({x:c.mark==='point'?row[c.x]:String(row[c.x]??''),
  series:c.series?String(row[c.series]??''):'',y:row[c.y],
  ...c.lat?{lat:row[c.lat],lon:row[c.lon]}:{}}));
// Script-made nodes take data-af-ids from DATA ids and row values, stable on every render.
const node=(tag,id,text)=>{const n=document.createElement(tag);n.dataset.afId=id;
  if(text!==undefined)n.textContent=text;return n;};
const byId=id=>[...document.querySelectorAll('[data-af-id]')].find(n=>n.dataset.afId===id);
const pick=(key,value)=>{picked[key]=picked[key]===value?null:value;listen();};
// The chart's values, collapsed under it; a picking chart's rows are its keyboard buttons.
function table(c,list){const id='chart-'+c.id+'-table',series=[...new Set(list.map(v=>v.series))];
  const box=node('details',id+'-box'),scroll=node('div',id+'-scroll'),t=node('table',id);
  const head=node('tr',id+'-head');scroll.className='scroll';
  box.append(node('summary',id+'-summary','Values in this chart'),scroll);scroll.append(t);
  head.append(node('th',id+'-head-x',label(c.x)),...series.map(s=>node('th',`${id}-head-${s}`,
    s||label(c.y))));
  t.append(node('caption',id+'-caption',`${c.title}: ${label(c.y)}`),head);
  for(const x of new Set(list.map(v=>v.x))){const tr=node('tr',`${id}-row-${x}`),
    th=node('th',`${id}-row-${x}-x`,c.filter?undefined:x);
    if(c.filter){const b=node('button',`${id}-row-${x}-pick`,x);b.type='button';th.append(b);
      b.setAttribute('aria-pressed',String(picked[c.filter]===x));b.onclick=()=>pick(c.filter,x);}
    tr.append(th,...series.map(s=>{const y=list.find(v=>v.x===x&&v.series===s)?.y;
      return node('td',`${id}-row-${x}-${s||'y'}`,fmt(y??NaN,Number.isInteger(y)?0:2));}));
    t.append(tr);}
  return box;}
const token=name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// Tokens as concrete sRGB for Vega and deck.gl, whatever colour syntax the design system uses.
const paint=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
const rgb=name=>{if(!paint)return [128,128,128];paint.fillStyle='#808080';
  paint.fillStyle=token(name)||'#808080';paint.fillRect(0,0,1,1);
  return [...paint.getImageData(0,0,1,1).data.slice(0,3)];};
const css=name=>`rgb(${rgb(name)})`;
function spec(c,list,w,config){const point=c.mark==='point',many=c.series&&c.multiples,
  sel=c.filter&&picked[c.filter],cols=many?Math.max(1,Math.min(4,Math.floor(w/170))):1;
  const x={field:'x',type:point?'quantitative':'ordinal',sort:null,title:label(c.x),
    axis:{labelAngle:0,labelOverlap:true}},y={field:'y',type:'quantitative',title:label(c.y)};
  const encoding=c.mark==='rect'?{x,y:{field:'series',type:'ordinal',sort:null,
    title:label(c.series)},color:{...y,scale:{range:[css('--muted'),config.range.category[0]]}}}:
    {x,y:{...y,scale:{zero:true},axis:{format:'.3~s'}},...c.series&&!many?{color:{
      field:'series',type:'nominal',sort:null,title:label(c.series)}}:{}};
  encoding.tooltip=[{field:'x',type:point?'quantitative':'nominal',title:label(c.x)},
    ...c.series?[{field:'series',type:'nominal',title:label(c.series)}]:[],{...y,format:','}];
  if(sel)encoding.opacity={condition:{test:`datum.x===${JSON.stringify(sel)}`,value:1},value:.3};
  const mark={bar:{type:'bar',cornerRadiusEnd:2},point:{type:'point',filled:true,opacity:.6},
    line:{type:'line',strokeWidth:2,point:!many&&{filled:true,size:25}},rect:{type:'rect'}}[c.mark];
  const view={mark:{...mark,...c.filter?{cursor:'pointer'}:{}},encoding};
  const rows=new Set(list.map(v=>v.series)).size;
  return {description:c.title,background:'transparent',data:{values:list},config,...many?{
    facet:{field:'series',type:'nominal',sort:null,title:null},columns:cols,spec:{
      width:Math.max(120,Math.floor(w/cols)-70),height:120,...view}}:{width:w,
      height:c.mark==='rect'?Math.max(160,rows*24+110):240,autosize:{type:'fit',contains:'padding'},
      ...view}};}
// A map: one dot per place, sized by y, without basemap tiles; it picks c.filter as a bar does.
async function map(c,host,list){const unavailable=()=>{host.textContent=
  'Map unavailable here: the table under it lists the same values.';return {finalize(){}};};
  try{const deck=await import('@afbin/deck-gl'),w=host.clientWidth||320,h=host.clientHeight||320;
    const sel=picked[c.filter],top=Math.max(1,...list.map(v=>v.y)),r=v=>4+14*Math.sqrt(v.y/top);
    const lon=list.map(v=>v.lon),lat=list.map(v=>v.lat),place=v=>[v.lon,v.lat];
    const fit=new deck.WebMercatorViewport({width:w,height:h}).fitBounds([[Math.min(...lon),
      Math.min(...lat)],[Math.max(...lon),Math.max(...lat)]],{padding:60});
    const at={longitude:fit.longitude,latitude:fit.latitude,zoom:Math.min(fit.zoom,10)},
      font=token('--font-body')||'sans-serif',named=fits(list,new deck.WebMercatorViewport({
        width:w,height:h,...at}),w,h,r,sel,font);
    const [ink,on,off]=[rgb('--foreground'),rgb('--chart-1'),rgb('--muted-foreground')];
    return new deck.Deck({parent:host,width:w,height:h,views:new deck.MapView(),controller:false,
      initialViewState:at,
      getCursor:({isHovering})=>isHovering?'pointer':'default',onError:unavailable,
      getTooltip:({object})=>object&&`${object.x}: ${fmt(object.y)} ${label(c.y)}`,
      onClick:({object})=>{if(object&&c.filter)pick(c.filter,object.x);},
      layers:[new deck.ScatterplotLayer({id:c.id+'-dots',data:list,getPosition:place,getRadius:r,
        radiusUnits:'pixels',pickable:true,stroked:true,lineWidthUnits:'pixels',getLineColor:ink,
        getFillColor:v=>sel&&v.x!==sel?[...off,90]:[...on,210]}),
      new deck.TextLayer({id:c.id+'-names',data:named,getPosition:place,getText:v=>v.x,getSize:12,
        getColor:ink,getPixelOffset:v=>v.offset,characterSet:'auto',fontFamily:font})]});
  }catch{return unavailable();}}
// The names that fit, biggest place first: above its dot, else below, right or left of it, 3px
// clear of its dot. A name that would cover a placed name, come within 3px of another dot or
// leave the map is dropped: close places never print over each other or read as each other's,
// and the dot's tooltip and the table still name it. A picked place goes first, over dim dots.
function fits(list,view,w,h,r,sel,font){const size=12,taken=[],hit=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&
  a[1]<b[3]&&b[1]<a[3],dots=list.map(v=>{const [x,y]=view.project([v.lon,v.lat]),s=r(v)+3;
    return {v,x,y,s,box:[x-s,y-s,x+s,y+s]};});
  if(paint)paint.font=`${size}px ${font}`;
  return [...dots].sort((a,b)=>(b.v.x===sel)-(a.v.x===sel)||b.v.y-a.v.y).flatMap(d=>{
    const tw=(paint?paint.measureText(d.v.x).width:d.v.x.length*size*.6)/2+2,th=size/2+2;
    for(const [dx,dy] of [[0,-d.s-th],[0,d.s+th],[d.s+tw,0],[-d.s-tw,0]]){
      const x=d.x+dx,y=d.y+dy,box=[x-tw,y-th,x+tw,y+th];
      if(box[0]<0||box[1]<0||box[2]>w||box[3]>h||taken.some(b=>hit(b,box))||
        d.v.x!==sel&&dots.some(o=>o!==d&&hit(o.box,box)))continue;
      taken.push(box);return [{...d.v,offset:[dx,dy]}];}
    return [];});}
async function draw(){views.forEach(view=>view.finalize());width=$('#charts').clientWidth;
  const ink=css('--foreground'),line=css('--border'),font=token('--font-body'),config={
    view:{stroke:null},font,range:{category:[1,2,3,4,5].map(n=>css('--chart-'+n))},
    mark:{color:css('--chart-1')},axis:{labelColor:ink,titleColor:ink,domainColor:line,
      tickColor:line,gridColor:line,gridDash:[3,3],labelFontSize:11,titleFontSize:12,
      titleFontWeight:'normal'},legend:{orient:'top',labelColor:ink,titleColor:ink},
    header:{labelColor:ink,labelFontSize:12},facet:{spacing:16}};
  views=await Promise.all(D.charts.map(async c=>{const host=byId(`chart-${c.id}-plot`),
    list=values(c);host.replaceChildren();if(c.mark==='map')return map(c,host,list);
    const view=new vega.View(vega.parse(compile(spec(c,list,host.clientWidth||320,config)).spec,
      undefined,{ast:true}),{container:host,renderer:'svg',expr:vega.expressionInterpreter});
    if(c.filter)view.addEventListener('click',(_,item)=>{if(item?.datum?.x!==undefined)
      pick(c.filter,String(item.datum.x));});
    await view.runAsync();return view;}));}
// One draw at a time; resizes and theme changes while one is waiting share it.
const redraw=()=>{if(!pending){pending=true;drawn=drawn.catch(()=>{}).then(()=>{pending=false;
  return draw();});}return drawn;};
function render(){const h=helpers,open=[...document.querySelectorAll('details[open]')]
  .map(d=>d.dataset.afId),focus=document.activeElement?.dataset?.afId;
  $('#title').textContent=document.title;$('#kicker').textContent=D.kicker;$('#lead').textContent=
    D.lead(h);
  const chips=Object.keys(filters).filter(k=>picked[k]!==null).map(k=>{const b=node('button',
    'filter-'+k,`${filters[k]}: ${picked[k]} ✕`);b.type='button';b.onclick=()=>pick(k,picked[k]);
    b.setAttribute('aria-label',`Clear ${filters[k]}: ${picked[k]}`);return b;});
  $('#filters').replaceChildren(...Object.keys(filters).length?[node('span','filters-text',
    chips.length?'Showing only':'Showing everything. Pick a bar, a dot or a table row to filter.'),
    ...chips]:[]);
  $('#stats').replaceChildren(...D.stats.map(s=>{const box=node('div','stat-'+s.id);
    box.append(node('span',`stat-${s.id}-label`,s.label),node('b',`stat-${s.id}-value`,
      s.value(h)));return box;}));
  $('#charts').replaceChildren(...D.charts.map(c=>{const section=node('section','chart-'+c.id),
    plot=node('div',`chart-${c.id}-plot`);plot.className=c.mark==='map'?'chart map':'chart';
    plot.setAttribute('role','img');plot.setAttribute('aria-label',c.title);
    section.className=c.wide?'rule wide':'rule';
    section.append(node('h2',`chart-${c.id}-title`,c.title),plot,...c.table===false?[]:
      [table(c,values(c))]);
    return section;}));
  $('#sections').replaceChildren(...D.sections.map(s=>{const section=node('section',
    'section-'+s.id);section.className='rule';section.append(node('h2',`section-${s.id}-title`,
    s.title),node('p',`section-${s.id}-text`,s.text(h)));return section;}));
  open.forEach(id=>byId(id)?.setAttribute('open',''));if(focus)byId(focus)?.focus();}
// watchQuery answers now and again whenever the linked dataset changes (another reader's write);
// a picked filter starts a new watch, and an older watch's late answer is ignored.
function listen(){watch?.unsubscribe();const mine=++round;status.textContent='Computing…';
  watch=client.watchQuery({query:pageQuery,variables:{...sqls,p:{...picked}}}).subscribe(
    async result=>{if(result.loading||mine!==round)return;
      if(result.errors?.length){status.textContent=result.errors[0].message||
        'Could not read the linked dataset.';return;}
      try{answers=Object.fromEntries(names.map(name=>[name,result.data?.[name]?.rows??[]]));
        render();await redraw();
        status.textContent=`Computed ${names.length} queries from the linked dataset.`;
      }catch(error){status.textContent=error.message||'Could not draw the linked dataset.';}});}
listen();
// Charts follow the reader's light or dark mode, the owner's design system and the page width.
const ready=()=>names.some(name=>answers[name]);
const theme=new MutationObserver(()=>{if(ready())void redraw();});
theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-af-dark',
  'data-af-design-system']});
const resize=new ResizeObserver(()=>{if(ready()&&$('#charts').clientWidth!==width)void redraw();});
resize.observe($('#charts'));
addEventListener('pagehide',()=>{watch?.unsubscribe();theme.disconnect();resize.disconnect();
  views.forEach(view=>view.finalize());},{once:true});
