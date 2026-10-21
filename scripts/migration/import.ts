import {destinationSchemas} from '../../src/migration/destination-schema.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {planMigration,applyMigration} from '../../src/migration/import.ts';
import {buildAccountMaps,PostgresMigrationDestination} from '../../src/migration/postgres.ts';
import {convertMigrationContent} from '../../src/migration/convert.ts';
import type {MigrationManifest,MigrationMaps} from '../../src/migration/contracts.ts';
const [manifestPath,schema,reportPath,...flags]=process.argv.slice(2);
if(!manifestPath||!schema||!reportPath)throw new Error('Usage: node --experimental-strip-types scripts/migration/import.ts <private-manifest.json> <dedicated-schema> <new-private-report.json> [--apply-isolated] [--editor-manage-restricted]');
destinationSchemas(schema); // Validate before reading source content, connecting, or initializing archives.
if(flags.some(f=>!['--apply-isolated','--editor-manage-restricted'].includes(f)))throw new Error('Unknown import flag');
const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as MigrationManifest;
const maps:MigrationMaps=buildAccountMaps(manifest);
const plan=await planMigration(manifest,{maps,convert:convertMigrationContent,coreUrl:'/af/v1/core.js'});
const apply=flags.includes('--apply-isolated');
const require=createRequire(import.meta.url);const {Client}=require('pg');
const db=apply?new Client({connectionString:process.env.MIGRATION_DESTINATION_DATABASE_URL}):null;
if(apply&&!process.env.MIGRATION_PUBLIC_ORIGIN)throw new Error('Explicit MIGRATION_PUBLIC_ORIGIN required for normalized HTML sources');
if(apply&&!process.env.MIGRATION_DESTINATION_DATABASE_URL)throw new Error('Explicit MIGRATION_DESTINATION_DATABASE_URL required');
const destination=new PostgresMigrationDestination(db??{query:async()=>{throw new Error('Dry run cannot query destination')}},{schema,origin:process.env.MIGRATION_PUBLIC_ORIGIN??'http://localhost:8787',isolated:apply,editorManageRestricted:flags.includes('--editor-manage-restricted')},plan.maps);
for(const page of plan.pages)if(!destination.supportsExactAccess(page)){page.disposition='blocked';page.issues.push('Destination cannot preserve exact access or deletion state');}
const inventory:Record<string,{total:number;ready:number;blocked:number}>={};
for(const page of plan.pages){const format=page.original.format;const row=inventory[format]??={total:0,ready:0,blocked:0};row.total++;if(page.disposition==='ready'&&destination.supportsExactAccess(page))row.ready++;else row.blocked++;}
let result;
if(db){await db.connect();try{await destination.prepare({manifest,maps:plan.maps});result=await applyMigration(plan,destination,{dryRun:false});}finally{await db.end();}}
else result=await applyMigration(plan,destination,{dryRun:true});
await writeFile(reportPath,JSON.stringify({dryRun:!apply,inventory,result,maps:plan.maps,pages:plan.pages.map(p=>({legacyId:p.legacyId,pageId:p.pageId,issues:p.issues,conversion:p.revisions.map(r=>({version:r.version,classification:r.conversion.classification,issues:r.conversion.issues})),accessSupported:destination.supportsExactAccess(p)}))}),{mode:0o600,flag:'wx'});
process.stdout.write(JSON.stringify({dryRun:!apply,inventory,result})+'\n');
