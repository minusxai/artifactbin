/** Native HTML page-speed workloads, published through the actual artifact API. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { samplePdf } from '../../lib/sample-pdf.mjs';
import { pageHtml, workloadHtml } from './native.mjs';
const read = file => readFileSync(path.join(import.meta.dirname,file),'utf8');
export const PAGE_SPEED_FIXTURES = [
 {key:'prose',title:'Perf A prose',painted:null},
 {key:'kit',title:'Perf B kit',painted:null,authorReady:true},
 {key:'dashboard',title:'Perf C dashboard',painted:{charts:2},authorReady:true},
 {key:'deck',title:'Perf D deck',painted:null},
 {key:'mermaid',title:'Perf E mermaid',painted:{diagrams:1}},
 {key:'mermaid-industry',title:'Perf F mermaid, industry theme',painted:{diagrams:1}},
 {key:'kitchen',title:'Perf G kitchen sink',painted:{charts:1},authorReady:true},
];
export async function publishPageSpeedFixtures(publish,visibility='unlisted') {
 const csv=read('sales.csv');
 const sales=await publish({title:'Perf sales',dataset:csv,visibility});
 const [columns,...lines]=csv.trim().split('\n').map(line=>line.split(','));
 const rows=lines.map(values=>Object.fromEntries(columns.map((key,i)=>[key,['revenue','units'].includes(key)?Number(values[i]):values[i]])));
 const linkTarget=await publish({title:'Perf link target',html:pageHtml('Related document','<p id="link-target-body">A second document the prose fixture links to.</p>'),visibility});
 const prose=read('prose.jsx').replace(/<Helmet>[\s\S]*?<\/Helmet>/,'').replaceAll('className=','class=');
 const published=[];
 for(const fixture of PAGE_SPEED_FIXTURES){
  let links=fixture.key==='prose'?`<p><a href="/a/${linkTarget.id}">A related document</a></p>`:'';
  if(fixture.key==='kitchen'){
   const image=await publish({title:'kit image',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',visibility});
   const pdf=await publish({title:'kit paper',pdf:`data:application/pdf;base64,${samplePdf(2).toString('base64')}`,visibility});
   links=`<nav><a href="/a/${sales.id}">Sales dataset</a> <a href="/a/${image.id}">Image</a> <a href="/a/${pdf.id}">PDF</a></nav>`;
  }
  const html=workloadHtml(fixture.key,{prose,rows,links});
  const made=await publish({title:fixture.title,html,visibility});
  published.push({...fixture,id:made.id});
 }
 return published;
}
