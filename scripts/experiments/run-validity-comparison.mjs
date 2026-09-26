/** Sequential runs: no competing benchmark processes; correctness gate precedes timings. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
const runs=[];
const execute=(name,args)=>{
 const file=openSync(`/tmp/artifact-${name}.log`,'w');
 const result=spawnSync(process.execPath,['scripts/experiments/single-row-benchmark.mjs',...args],{stdio:['ignore',file,file]});closeSync(file);
 assert.equal(result.status,0,`${name} failed; inspect /tmp/artifact-${name}.log`);
};
execute('validity-final',['--validity']);
for(const [paragraphs,repeats] of [[1000,3],[5000,1]])for(let repeat=0;repeat<repeats;repeat++){
 for(const mode of ['baseline','certified','read-free']){
  const name=`comparison-${paragraphs}-${repeat}-${mode}`;
  execute(name,['--sustained-only',`--paragraphs=${paragraphs}`,...(mode==='baseline'?['--app-only']:['--jsonb-app','--certified',...(mode==='read-free'?['--read-free']:[])])]);
  const path=mode==='baseline'?'/tmp/artifact-single-row-sustained-results.json':mode==='read-free'?'/tmp/artifact-jsonb-read-free-results.json':'/tmp/artifact-jsonb-certified-app-results.json';
  const result=JSON.parse(readFileSync(path,'utf8'));
  for(const row of result.sustained){runs.push({paragraphs,repeat,...row});console.log(JSON.stringify(runs.at(-1)));}
  writeFileSync(`/tmp/artifact-${name}.json`,JSON.stringify(result,null,2));
  writeFileSync('/tmp/artifact-validated-comparison.json',JSON.stringify({validity:JSON.parse(readFileSync('/tmp/artifact-validity-results.json','utf8')),runs},null,2));
 }
}
