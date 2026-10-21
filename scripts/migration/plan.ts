import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planMigration } from '../../src/migration/import.ts';
import type { Converter, MigrationManifest, MigrationMaps } from '../../src/migration/contracts.ts';
// Converter modules export `convertMigrationContent: Converter`. No server is started.
const [manifestPath,mapsPath,converterPath,outputDirectory]=process.argv.slice(2);
if(!manifestPath||!mapsPath||!converterPath||!outputDirectory)throw new Error('Usage: node --experimental-strip-types scripts/migration/plan.ts <private-manifest.json> <private-maps.json> <converter-module> <new-private-output-directory>');
const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as MigrationManifest;
const maps=JSON.parse(await readFile(mapsPath,'utf8')) as MigrationMaps;
const module=await import(pathToFileURL(resolve(converterPath)).href) as {convertMigrationContent:Converter};
if(typeof module.convertMigrationContent!=='function')throw new Error('Converter must export convertMigrationContent');
const plan=await planMigration(manifest,{maps,convert:module.convertMigrationContent,coreUrl:'/af/v1/core.js'});
await mkdir(outputDirectory,{mode:0o700});
await writeFile(resolve(outputDirectory,'plan.json'),JSON.stringify(plan),{mode:0o600,flag:'wx'});
for(const page of plan.pages){
 await mkdir(resolve(outputDirectory,page.pageId),{mode:0o700});
 for(const revision of page.revisions)if(revision.conversion.html!==null)await writeFile(resolve(outputDirectory,page.pageId,`v${revision.version}.html`),revision.conversion.html,{mode:0o600,flag:'wx'});
}
// Only counts go to stdout; content, identities and source addresses stay in the private bundle.
process.stdout.write(JSON.stringify({pages:plan.pages.length,ready:plan.pages.filter(p=>p.disposition==='ready').length,blocked:plan.pages.filter(p=>p.disposition==='blocked').length})+'\n');
