import {destinationSchemas} from '../../src/migration/destination-schema.ts';
import {createRequire} from 'node:module';
import {open,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readStreamManifest,readPartRows} from '../../src/migration/stream.ts';
import {indexStreamArchive,indexedArtifactIds,readIndexedAccounts,readIndexedArtifact} from '../../src/migration/stream-index.ts';
import {PostgresStreamArchive} from '../../src/migration/stream-postgres.ts';
import {PostgresMigrationDestination,buildAccountMaps} from '../../src/migration/postgres.ts';
import {allocateMigrationMaps,planMigration,applyMigration} from '../../src/migration/import.ts';
import {convertMigrationContent} from '../../src/migration/convert.ts';
import {rewriteMigrationLinks} from '../../src/migration/links.ts';
import type {MigrationManifest} from '../../src/migration/contracts.ts';
const [directory,indexDirectory,schema,reportPath,...flags]=process.argv.slice(2);
if(!directory||!indexDirectory||!schema||!reportPath)throw new Error('Usage: node --experimental-strip-types scripts/migration/import-stream.ts <private-export-directory> <private-index-directory> <dedicated-schema> <new-private-report.ndjson> [--apply-isolated] [--editor-manage-restricted]');
destinationSchemas(schema); // Validate before reading source content, connecting, or initializing archives.
if(flags.some(f=>!['--apply-isolated','--editor-manage-restricted'].includes(f)))throw new Error('Unknown import flag');
const manifest=await readStreamManifest(directory);
try{const indexed=JSON.parse(await readFile(join(indexDirectory,'manifest.json'),'utf8'));if(JSON.stringify(indexed)!==JSON.stringify(manifest))throw new Error('Index belongs to another source snapshot');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await indexStreamArchive(directory,indexDirectory,manifest);}
const accounts=await readIndexedAccounts(indexDirectory);
const base:MigrationManifest={schemaVersion:1,sourceNamespace:manifest.sourceNamespace,exportedAt:manifest.exportedAt,tables:{users:accounts.users},tokenOwners:accounts.tokenOwners,artifacts:[]};
const ids:string[]=[];for await(const id of indexedArtifactIds(indexDirectory))ids.push(id);
const maps=allocateMigrationMaps(manifest.sourceNamespace,ids,buildAccountMaps(base));
// Only small account/ID metadata is retained across artifacts, never document/history/edit bodies.
for await(const id of indexedArtifactIds(indexDirectory)){const artifact=await readIndexedArtifact(indexDirectory,manifest,id);if(artifact.artifacts[0]?.format==='folder')base.artifacts.push(artifact.artifacts[0]);}
const apply=flags.includes('--apply-isolated');
if(apply&&(!process.env.MIGRATION_DESTINATION_DATABASE_URL||!process.env.MIGRATION_PUBLIC_ORIGIN))throw new Error('Explicit MIGRATION_DESTINATION_DATABASE_URL and MIGRATION_PUBLIC_ORIGIN required');
const require=createRequire(import.meta.url);const {Client}=require('pg');const db=apply?new Client({connectionString:process.env.MIGRATION_DESTINATION_DATABASE_URL}):null;
const destination=new PostgresMigrationDestination(db??{query:async()=>{throw new Error('Dry run cannot query destination')}},{schema,origin:process.env.MIGRATION_PUBLIC_ORIGIN??'http://localhost:8787',isolated:apply,editorManageRestricted:flags.includes('--editor-manage-restricted')},maps);
const report=await open(reportPath,'wx',0o600);const inventory:Record<string,{total:number;ready:number;blocked:number}>={};const totals={created:0,unchanged:0,blocked:0};
try{
 if(db){await db.connect();const archive=new PostgresStreamArchive(db,schema,true);await archive.initialize();for(const part of manifest.parts)await archive.archivePart(manifest.sourceNamespace,part,readPartRows(directory,part));await destination.prepare({manifest:base,maps});}
 for await(const id of indexedArtifactIds(indexDirectory)){
  const artifact=await readIndexedArtifact(indexDirectory,manifest,id);
  const plan=await planMigration(artifact,{maps,convert:async input=>{const result=await convertMigrationContent(input);return result.html===null?result:{...result,html:rewriteMigrationLinks(result.html,maps,{legacyOrigins:(process.env.MIGRATION_LEGACY_ORIGINS??'').split(',').filter(Boolean),targetOrigin:process.env.MIGRATION_PUBLIC_ORIGIN??'http://localhost:8787'})};},coreUrl:'/af/v1/core.js'});
  for(const page of plan.pages){if(!destination.supportsExactAccess(page)){page.disposition='blocked';page.issues.push('Destination cannot preserve exact access or deletion state');}
   const row=inventory[page.original.format]??={total:0,ready:0,blocked:0};row.total++;if(page.disposition==='ready')row.ready++;else row.blocked++;
   const result=await applyMigration(plan,destination,{dryRun:!apply});totals.created+=result.created;totals.unchanged+=result.unchanged;totals.blocked+=result.blocked;
   await report.writeFile(JSON.stringify({legacyId:page.legacyId,pageId:page.pageId,format:page.original.format,disposition:page.disposition,issues:page.issues,revisions:page.revisions.map(r=>({version:r.version,classification:r.conversion.classification,issues:r.conversion.issues})),result})+'\n');
  }
 }
 await report.sync();await writeFile(reportPath+'.summary.json',JSON.stringify({complete:true,dryRun:!apply,inventory,result:totals,maps}),{mode:0o600,flag:'wx'});
 process.stdout.write(JSON.stringify({complete:true,dryRun:!apply,inventory,result:totals})+'\n');
}finally{await report.close();if(db)await db.end();}
