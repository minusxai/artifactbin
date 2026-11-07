/**
 * scripts/new-page.mjs: a page computed from a CSV set up in one call, against a fake server: it
 * publishes the CSV as a named dataset, copies examples/csv-dashboard.html and its steps file, and
 * writes a DATA block that reads only this CSV's columns; a rerun reuses the dataset and keeps edits.
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
  expect((await readdir(p.dir)).filter(n=>!n.endsWith('.af.json')).sort()).toEqual(['index.html','sales.csv','steps.mjs']);
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts']);
  expect(p.calls[0].body).toMatchObject({title:'Revenue by region data',dataset:CSV});
  expect(result.dataset).toEqual({id:'DATA0001',name:'sales',rows:3,columns:['month','region','revenue','orders'],numbers:['revenue','orders'],reused:false});
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('<title>Revenue by region</title>');
  expect(html).toContain('data-af-name="sales" href="ref:DATA0001"');
  expect(html).toContain("dataset: 'sales', order: 'month'");
  expect(html).toContain("labels: {month:'Month', region:'Region', revenue:'Revenue', orders:'Orders'}");
  // Every column DATA reads is one of this CSV's: nothing of the sample (repairs) is left.
  const data=html.slice(html.indexOf('window.DATA'),html.indexOf('</script>'));
  expect(data).not.toMatch(/repairs|completed|waiting|week/);
  for(const col of data.matchAll(/(?:h\.(?:sum|last|mean)\('|[xy]:')(\w+)'/g))expect(['month','region','revenue','orders']).toContain(col[1]);
  expect(data).toContain("{id:'revenue', title:'[Revenue by month]', mark:'bar', x:'month', y:'revenue'}");
  // What it drew and how to change it, in this CSV's own names: an agent that misread the starter
  // ("a chart per region, not what we want") wrote its own page instead (2026-11-07).
  expect(result.draws).toBe('DATA draws a lead, a total per number column (revenue, orders), and a bar chart of revenue summed per month and orders summed per month, each with a table of its values (3 rows).');
  expect(result.next).toMatch(/^Next: in index\.html edit only DATA \(its \[bracketed\] text/);
  for(const variation of ["one line: mark:'line'","a line or bar per region: series:'region'","only some rows: where:{region:'North'}","one value per month as given: aggregate:'last'",'no value table: table:false','no stats or sections: stats:[], sections:[]',"a number for one month in a text: h.where({month:'2026-01'}).sum('revenue')"])expect(result.next).toContain(variation);
  expect(result.next).toContain('node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs');
  // A rebuild of an existing page publishes over it.
  const again:any=await p.run({dir:'page',data:'sales.csv',title:'Revenue by region',artifact:'PAGE01'});
  expect(again.dataset.reused).toBe(true);expect(p.calls.length).toBe(1);
  expect(again.kept).toEqual(['index.html','steps.mjs','sales.csv']);
  expect(again.next).toContain('node scripts/publish.mjs index.html --artifact PAGE01 && node scripts/check.mjs');
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
