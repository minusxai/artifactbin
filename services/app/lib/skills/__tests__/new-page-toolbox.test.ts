/**
 * scripts/new-page.mjs: a page computed from a CSV set up in one call, with no server call: it copies the CSV into
 * the project, copies examples/csv-dashboard.html (linking the CSV by its path, so the page's publish creates and
 * later updates its one dataset), its renderer and its steps file, and writes a DATA block that reads only this
 * CSV's columns; a rerun keeps edits and brings the copied CSV up to date.
 */
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const server='https://example.test';
const CSV='month,region,revenue,orders\n2026-01,North,48200,310\n2026-01,South,31150,204\n2026-02,North,51300,322\n';

async function project(){
 const {newPageCommand}=await import('../../../skills/artifactbin/scripts/new-page.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'new-page-')),dir=path.join(root,'page');await mkdir(dir);
 await writeFile(path.join(root,'sales.csv'),CSV);
 const calls:any[]=[];let made=0;
 const fetcher=async(url:any,init:any)=>{const {pathname}=new URL(String(url)),method=init?.method??'GET';
  calls.push({method,path:pathname,body:init?.body?JSON.parse(String(init.body)):undefined});
  if(pathname==='/api/artifacts'&&method==='POST'){const id='DATA'+String(++made).padStart(4,'0');
   return Response.json({id,url:server+'/a/'+id,version:1,state:'a'.repeat(64),format:'dataset'},{status:201});}
  return Response.json({error:'unexpected'},{status:500});};
 const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:path.join(root,'home')},fetcher,cwd:root,log:()=>{}};
 const run=(values:Record<string,unknown>)=>newPageCommand({values:{server,...values},positionals:[]},options);
 return {root,dir,run,calls,done:()=>rm(root,{recursive:true,force:true})};
}

it('sets up a CSV page in one call: the dataset, the starter and a DATA block over this CSV',async()=>{
 const p=await project();
 try{
  const result:any=await p.run({dir:'page',data:'sales.csv',title:'Revenue by region'});
  expect((await readdir(p.dir)).sort()).toEqual(['csv-dashboard.mjs','index.html','sales.csv','steps.mjs']);
  // The renderer is copied byte for byte, beside the page that loads it.
  expect(await readFile(path.join(p.dir,'csv-dashboard.mjs'),'utf8')).toBe(await readFile(new URL('../../../skills/artifactbin/examples/csv-dashboard.mjs',import.meta.url),'utf8'));
  // Nothing is published yet: the page's first publish creates the dataset from the linked file.
  expect(p.calls).toEqual([]);
  expect(result.dataset).toEqual({file:'sales.csv',name:'sales',rows:3,columns:['month','region','revenue','orders'],numbers:['revenue','orders']});
  expect(result.note).toBe('index.html links sales.csv (3 rows) as sales and is titled "Revenue by region"; its first publish creates the sales dataset, and a later publish after sales.csv changes updates that same dataset.');
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('<title>Revenue by region</title>');
  expect(html).toContain('data-af-name="sales" href="./sales.csv"');expect(html).not.toContain('ref:');
  expect(html).toContain("totals: 'select count(*) as row_count, sum(revenue) as revenue, sum(orders) as orders from sales'");
  expect(html).toContain("by_month: 'select month, sum(revenue) as revenue, sum(orders) as orders from sales group by month order by month'");
  expect(html).toContain("labels: {month:'Month', region:'Region', revenue:'Revenue', orders:'Orders'}");
  expect(html).toContain('<script type="module" src="./csv-dashboard.mjs"></script>');
  // Every column DATA reads is one of this CSV's: nothing of the sample (deliveries) is left, filters included.
  const data=html.slice(html.indexOf('window.DATA'),html.indexOf('</script>'));
  expect(data).not.toMatch(/deliveries|distance_km|category|city|filters|\$\w/);
  for(const col of data.matchAll(/(?:\[|\b[xy]:)'(\w+)'/g))expect(['month','region','revenue','orders']).toContain(col[1]);
  expect(data).toContain("{id:'revenue', title:'[Revenue by month]', mark:'bar', query:'by_month', x:'month', y:'revenue'}");
  // What it drew and how to change it, in this CSV's own names: an agent that misread the starter
  // ("a chart per region, not what we want") wrote its own page instead (2026-11-07).
  expect(result.draws).toBe("DATA's _sql queries compute a total per number column (revenue, orders) and revenue summed per month and orders summed per month; it draws a lead, those totals and a bar chart of each, with a table of its values (3 rows).");
  expect(result.next).toMatch(/^Next: in index\.html edit only DATA \(its \[bracketed\] text/);
  for(const variation of ["one line: mark:'line'","a line or bar per region: select and group by region in the query, then series:'region'","only some rows: where region = 'North' in the query","one value per month as given: a query without sum or group by",'no value table: table:false','no stats or sections: stats:[], sections:[]',"a number for one month in a text: a query with sum(revenue) where month = '2026-01', read as h.one(name).revenue",'another dataset: link it and join it in SQL',
   // The deeper ones, as the starter draws them, in this CSV's names: no map without coordinates.
   "and, as examples/csv-dashboard.html draws them: a small panel per region: series:'region', multiples:true, a heatmap of month by region: mark:'rect', series:'region', charts that filter each other: filters:{region:'Region'}, filter:'region' on a chart with x:'region', and where ($region is null or region = $region) in the other queries, the spread of revenue: bars of count(*) per bin, cast(revenue / 10 as int) * 10, grouped in SQL, orders against revenue: mark:'point', x:'orders', a row per record, table:false"])expect(result.next).toContain(variation);
  expect(result.next).not.toContain("mark:'map'");
  expect(result.next).toContain('node scripts/publish.mjs index.html --create && node scripts/check.mjs index.html --steps steps.mjs');
  // A rebuild of an existing page publishes over it.
  const again:any=await p.run({dir:'page',data:'sales.csv',title:'Revenue by region',artifact:'PAGE01'});
  expect(again).toMatchObject({created:[],kept:['index.html','csv-dashboard.mjs','steps.mjs','sales.csv'],updated:[]});
  expect(again.next).toContain('node scripts/publish.mjs index.html --artifact PAGE01 && node scripts/check.mjs');
  // Once published (its marker is in index.html) a rerun says to publish it plainly; changed rows replace the copy,
  // which that publish sends over the same dataset.
  const {stampSource}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
  await writeFile(path.join(p.dir,'index.html'),stampSource(html,{server,id:'PAGE01',version:1,state:'a'.repeat(64),sha256:'b'.repeat(64),entryPath:'index.html'}));
  await writeFile(path.join(p.root,'sales.csv'),CSV+'2026-02,South,30000,190\n');
  const changed:any=await p.run({dir:'page',data:'sales.csv',title:'Revenue by region'});
  expect(changed).toMatchObject({updated:['sales.csv'],kept:['index.html','csv-dashboard.mjs','steps.mjs']});
  expect(await readFile(path.join(p.dir,'sales.csv'),'utf8')).toBe(CSV+'2026-02,South,30000,190\n');
  expect(changed.next).toContain('then node scripts/publish.mjs index.html && node scripts/check.mjs');
  expect(p.calls).toEqual([]);
  // A file name that is no plain name is copied under the dataset name it links.
  await writeFile(path.join(p.root,'Q1 sales.csv'),CSV);
  const spaced:any=await p.run({dir:'page2',data:'Q1 sales.csv',title:'Q1'});
  expect(spaced.dataset).toMatchObject({file:'q1_sales.csv',name:'q1_sales'});
  expect(await readFile(path.join(p.root,'page2','index.html'),'utf8')).toContain('data-af-name="q1_sales" href="./q1_sales.csv"');
  expect((await readdir(path.join(p.root,'page2'))).filter(n=>n.endsWith('.af.json'))).toEqual([]);
 }finally{await p.done();}
});

it('names a map among the variations when the CSV has coordinates',async()=>{
 const p=await project();
 try{
  await writeFile(path.join(p.root,'stops.csv'),'stop,lat,lng,visits\nHarbour,52.37,4.9,12\nMarket,52.36,4.88,7\n');
  const result:any=await p.run({dir:'page',data:'stops.csv',title:'Stops'});
  expect(result.next).toContain("a map: mark:'map', lat:'lat', lon:'lng', x the place, y its size");
  // Coordinates are numbers, but DATA neither sums nor charts them: it totals visits per stop.
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain("totals: 'select count(*) as row_count, sum(visits) as visits from stops'");
  expect(html).toContain("by_stop: 'select stop, sum(visits) as visits from stops group by stop order by stop'");
  expect(html).not.toMatch(/sum\((?:lat|lng)\)/);
 }finally{await p.done();}
});

it('refuses a missing CSV, a CSV with no rows and a missing title with the one next step',async()=>{
 const p=await project();
 try{
  await expect(p.run({data:'sales.csv'})).rejects.toMatchObject({code:'missing_title',exit:2});
  await expect(p.run({title:'T'})).rejects.toMatchObject({code:'missing_data',exit:2});
  await expect(p.run({title:'T',data:'nope.csv'})).rejects.toMatchObject({code:'data_not_found',exit:2});
  await writeFile(path.join(p.root,'empty.csv'),'a,b\n');
  await expect(p.run({title:'T',data:'empty.csv'})).rejects.toMatchObject({code:'data_empty',exit:2});
 }finally{await p.done();}
});
