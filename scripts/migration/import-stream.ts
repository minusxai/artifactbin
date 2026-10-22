import {planMigrationGroups} from '../../src/migration/groups.ts';
import {cachedMigrationConverter,archivedCompilerIdentity} from '../../src/migration/cache.ts';
import {destinationSchemas} from '../../src/migration/destination-schema.ts';
import {createRequire} from 'node:module';
import {open,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readStreamManifest,readPartRows} from '../../src/migration/stream.ts';
import {indexStreamArchive,indexedArtifactIds,indexedArtifactHeaders,readIndexedAccounts,readIndexedArtifact} from '../../src/migration/stream-index.ts';
import {PostgresStreamArchive} from '../../src/migration/stream-postgres.ts';
import {PostgresMigrationDestination,buildAccountMaps} from '../../src/migration/postgres.ts';
import {allocateMigrationMaps,planMigration,applyMigration} from '../../src/migration/import.ts';
import {createMigrationConverter} from '../../src/migration/convert.ts';
import {rewriteMigrationLinks} from '../../src/migration/links.ts';
import {planMigrationIdentities,isPreservedNonloginActor} from '../../src/migration/identities.ts';
import type {MigrationManifest} from '../../src/migration/contracts.ts';
const [directory,indexDirectory,schema,reportPath,...flags]=process.argv.slice(2);
if(!directory||!indexDirectory||!schema||!reportPath)throw new Error('Usage: node --experimental-strip-types scripts/migration/import-stream.ts <private-export-directory> <private-index-directory> <dedicated-schema> <new-private-report.ndjson> [--apply-isolated] [--editor-manage-restricted] [--conversion-strategy=strict|archived-static]');
destinationSchemas(schema); // Validate before reading source content, connecting, or initializing archives.
if(flags.some(f=>!['--apply-isolated','--editor-manage-restricted','--conversion-strategy=strict','--conversion-strategy=archived-static','--concurrency=1','--concurrency=2'].includes(f)))throw new Error('Unknown import flag');
if(flags.filter(f=>f.startsWith('--conversion-strategy=')).length>1)throw new Error('Choose one explicit conversion strategy');
const conversionStrategy=flags.includes('--conversion-strategy=archived-static')?'archived-static':'strict';
let convert=createMigrationConverter({strategy:conversionStrategy,legacyRoot:process.env.MIGRATION_ARCHIVED_ROOT});
const cache=process.env.MIGRATION_CONVERSION_CACHE?cachedMigrationConverter(convert,{directory:process.env.MIGRATION_CONVERSION_CACHE,compilerIdentity:await archivedCompilerIdentity(process.env.MIGRATION_ARCHIVED_ROOT??''),strategy:conversionStrategy}):null;if(cache)convert=cache.convert;
const manifest=await readStreamManifest(directory);
const authorityTables:Record<string,import('../../src/migration/contracts.ts').LegacyRow[]>={};for(const name of ['groups','group_members','group_links']){authorityTables[name]=[];for(const part of manifest.parts.filter(p=>p.table===name))for await(const row of readPartRows(directory,part))authorityTables[name]!.push(row);}
try{const indexed=JSON.parse(await readFile(join(indexDirectory,'manifest.json'),'utf8'));if(JSON.stringify(indexed)!==JSON.stringify(manifest))throw new Error('Index belongs to another source snapshot');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await indexStreamArchive(directory,indexDirectory,manifest);}
const accounts=await readIndexedAccounts(indexDirectory);
const base:MigrationManifest={schemaVersion:1,sourceNamespace:manifest.sourceNamespace,exportedAt:manifest.exportedAt,tables:{users:accounts.users,...authorityTables},tokenOwners:accounts.tokenOwners,artifacts:[]};
const ids:string[]=[];for await(const id of indexedArtifactIds(indexDirectory))ids.push(id);
const maps=allocateMigrationMaps(manifest.sourceNamespace,ids,buildAccountMaps(base));
const identities=planMigrationIdentities(base).identities;const groups=planMigrationGroups(base,maps.users);const groupSummary={mapped:groups.groups.length,active:groups.groups.filter(g=>g.active).length,inactive:groups.groups.filter(g=>!g.active).length,blocked:groups.blocked.length,memberships:groups.groups.reduce((n,g)=>n+g.members.length,0)};
const identitySummary={emailLogin:identities.filter(i=>i.classification==='email-login').length,preservedNonlogin:identities.filter(i=>i.classification==='preserved-nonlogin').length,blocked:identities.filter(i=>i.classification==='blocked').length};
// Only small account/ID metadata is retained across artifacts, never document/history/edit bodies.
for await(const header of indexedArtifactHeaders(indexDirectory))if(header.format==='folder'){const artifact=await readIndexedArtifact(indexDirectory,manifest,header.id);base.artifacts.push(artifact.artifacts[0]!);}
const apply=flags.includes('--apply-isolated');
if(flags.filter(f=>f.startsWith('--concurrency=')).length>1)throw new Error('Choose one concurrency');
const concurrency=flags.includes('--concurrency=2')?2:1;if(apply&&concurrency!==1)throw new Error('Destination writes require concurrency 1');
if(apply&&(!process.env.MIGRATION_DESTINATION_DATABASE_URL||!process.env.MIGRATION_PUBLIC_ORIGIN))throw new Error('Explicit MIGRATION_DESTINATION_DATABASE_URL and MIGRATION_PUBLIC_ORIGIN required');
const require=createRequire(import.meta.url);const {Client}=require('pg');const db=apply?new Client({connectionString:process.env.MIGRATION_DESTINATION_DATABASE_URL}):null;
const destination=new PostgresMigrationDestination(db??{query:async()=>{throw new Error('Dry run cannot query destination')}},{schema,origin:process.env.MIGRATION_PUBLIC_ORIGIN??'http://localhost:8787',isolated:apply,editorManageRestricted:flags.includes('--editor-manage-restricted')},maps);
const conversionProvenance:Record<string,number>={};
const report=await open(reportPath,'wx',0o600);let reportWrites=Promise.resolve();const writeReport=(line:string)=>{reportWrites=reportWrites.then(()=>report.writeFile(line));return reportWrites;};const inventory:Record<string,{total:number;ready:number;blocked:number}>={};const totals={created:0,unchanged:0,blocked:0,errors:0};
try{
 if(db){await db.connect();const archive=new PostgresStreamArchive(db,schema,true);await archive.initialize();for(const part of manifest.parts)await archive.archivePart(manifest.sourceNamespace,part,readPartRows(directory,part));await destination.prepare({manifest:base,maps});}
 for(let offset=0;offset<ids.length;offset+=concurrency)await Promise.all(ids.slice(offset,offset+concurrency).map(async id=>{
  const artifact=await readIndexedArtifact(indexDirectory,manifest,id);
  try{
  const plan=await planMigration(artifact,{maps,convert:async input=>{const result=await convert(input);return result.html===null?result:{...result,html:rewriteMigrationLinks(result.html,maps,{legacyOrigins:(process.env.MIGRATION_LEGACY_ORIGINS??'').split(',').filter(Boolean),targetOrigin:process.env.MIGRATION_PUBLIC_ORIGIN??'http://localhost:8787'})};},coreUrl:'/af/v1/core.js'});
  for(const page of plan.pages){for(const revision of page.revisions){const p=revision.conversion.provenance;const key=JSON.stringify({strategy:revision.conversion.strategy??conversionStrategy,classification:revision.conversion.classification,compiler:p?.compiler??null,build:p?.build??null,mode:p?.mode??null});conversionProvenance[key]=(conversionProvenance[key]??0)+1;}if(!destination.supportsExactAccess(page)){page.disposition='blocked';page.issues.push('Destination cannot preserve exact access or deletion state');}
   const row=inventory[page.original.format]??={total:0,ready:0,blocked:0};row.total++;if(page.disposition==='ready')row.ready++;else row.blocked++;
   const result=await applyMigration(plan,destination,{dryRun:!apply});totals.created+=result.created;totals.unchanged+=result.unchanged;totals.blocked+=result.blocked;
   await writeReport(JSON.stringify({legacyId:page.legacyId,pageId:page.pageId,format:page.original.format,disposition:page.disposition,unavailableCommentContexts:page.unavailableCommentContexts,ownerAccess:page.owner?.kind==='group'?'group-membership':page.owner?isPreservedNonloginActor(page.owner.id)?'preserved-nonlogin-unclaimable':'email-login':'unmapped',issues:page.issues,revisions:page.revisions.map(r=>({version:r.version,classification:r.conversion.classification,strategy:r.conversion.strategy??conversionStrategy,provenance:r.conversion.provenance,issues:r.conversion.issues})),result})+'\n');
  }
  }catch(error){
   if(apply)throw error;
   const format=artifact.artifacts[0]!.format;const row=inventory[format]??={total:0,ready:0,blocked:0};row.total++;row.blocked++;totals.blocked++;totals.errors++;
   await writeReport(JSON.stringify({legacyId:id,pageId:maps.pages[id],format,disposition:'error',issues:[error instanceof Error?error.message:'Unknown migration plan failure']})+'\n');
  }
 }));
 await reportWrites;await report.sync();await writeFile(reportPath+'.summary.json',JSON.stringify({complete:true,dryRun:!apply,inventory,result:totals,identitySummary,groupSummary,conversionStrategy,conversionCache:cache?.stats,conversionProvenance,maps}),{mode:0o600,flag:'wx'});
 process.stdout.write(JSON.stringify({complete:true,dryRun:!apply,inventory,result:totals,identitySummary,groupSummary,conversionStrategy,conversionCache:cache?.stats,conversionProvenance})+'\n');
}finally{await report.close();if(db)await db.end();}
