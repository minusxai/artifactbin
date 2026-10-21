import {mkdtemp,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('.',import.meta.url));
const original=await readFile(base+'workflow.ts','utf8');
const changes=[
 ['stale-push overwrite','if (d.current !== expectedRevision) fail("CONFLICT");',''],
 ['private-read bypass','(!write && d.access !== "private")','!write'],
 ['historical substitution','version(d, comment.sourceRevision)','version(d, d.current)'],
 ['duplicate-comment overwrite','if (key(previous) !== key(comment)) fail("IDEMPOTENCY_CONFLICT");',''],
 ['stale-bridge callback','!active || candidate !== generation','!active'],
];
for(const [name,from,to]of changes){if(!original.includes(from))throw Error('Missing mutation target');const dir=await mkdtemp(base+'.mutation-');try{for(const file of ['contracts.ts','workflow.test.ts'])await cp(base+file,dir+'/'+file);await writeFile(dir+'/workflow.ts',original.replace(from,to));const result=spawnSync(process.execPath,['--import','tsx','--test',dir+'/workflow.test.ts'],{encoding:'utf8'});if(result.status===0||!result.stdout.includes('not ok'))throw Error('Mutation survived or harness failed: '+name);console.log('Detected: '+name);}finally{await rm(dir,{recursive:true,force:true});}}
