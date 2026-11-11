import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
/** Build the source-relative browser runtime before the server becomes one relocated file. */
function compileCore(root){
 const entry=pathToFileURL(path.resolve(root,'services/app/lib/html-runtime/build.server.ts')).href;
 return JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`const {buildHtmlAssets}=await import(${JSON.stringify(entry)});process.stdout.write(JSON.stringify(await buildHtmlAssets()));`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}));
}
export function prebuiltHtmlCore(root,compile=()=>compileCore(root)){
 const entry=realpathSync(path.resolve(root,'services/app/lib/html-runtime/build.server.ts'));let source;
 return {name:'prebuilt-html-core',setup(builder){builder.onLoad({filter:/html-runtime[/\\]build\.server\.ts$/},args=>{
  if(args.path!==entry)return;
  source??=compile();if(!source.core?.trim()||!source.apollo?.trim()||!source.apolloPath)throw Error('HTML core assets are empty');
  return {contents:`const assets=${JSON.stringify(source)};export async function buildHtmlAssets(){return assets}export async function buildHtmlCore(){return assets.core}`,loader:'js'};
 });}};
}

function compilePreviewAssets(root){
 const entry=pathToFileURL(path.resolve(root,'services/app/lib/skills/preview-assets.server.ts')).href;
 const parserFile=path.resolve(root,'services/app/skills/artifactbin/scripts/preview-html.mjs');
 return JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readFileSync,readdirSync} from 'node:fs';import path from 'node:path';const {buildPreviewParser,buildToolboxPlatform,compactSkillScript}=await import(${JSON.stringify(entry)});const parserSource=readFileSync(${JSON.stringify(parserFile)},'utf8');const scripts=path.dirname(${JSON.stringify(parserFile)});const compactedScripts=Object.fromEntries(await Promise.all(readdirSync(scripts).filter(name=>name.endsWith('.mjs')).map(async name=>{const source=readFileSync(path.join(scripts,name),'utf8');return [source,await compactSkillScript(source)];})));process.stdout.write(JSON.stringify({compactedScripts,parserSource,parser:await buildPreviewParser(parserSource),toolbox:await buildToolboxPlatform()}));`],{cwd:path.join(root,'services/app'),encoding:'utf8',maxBuffer:16*1024*1024}));
}
/** Prebuild Node-only skill helpers and script compactions before relocation.
 * The deployed module only looks up immutable source inputs; it never imports a compiler. */
export function prebuiltPreviewAssets(root,compile=()=>compilePreviewAssets(root)){
 const entry=realpathSync(path.resolve(root,'services/app/lib/skills/preview-assets.server.ts'));let source;
 return {name:'prebuilt-preview-assets',setup(builder){builder.onLoad({filter:/skills[/\\]preview-assets\.server\.ts$/},args=>{
  if(args.path!==entry)return;
  source??=compile();if(!source.parser?.trim()||!source.toolbox?.trim()||!source.parserSource||!source.compactedScripts||!Object.keys(source.compactedScripts).length)throw Error('Preview helper assets are empty');
  return {contents:`const assets=${JSON.stringify(source)};export async function buildPreviewParser(source){if(source!==assets.parserSource)throw Error('Skill preview parser source differs from built assets');return assets.parser}export async function buildToolboxPlatform(){return assets.toolbox}export async function compactSkillScript(source){if(!Object.hasOwn(assets.compactedScripts,source))throw Error('Skill script source differs from built assets');return assets.compactedScripts[source]}`,loader:'js'};
 });}};
}
