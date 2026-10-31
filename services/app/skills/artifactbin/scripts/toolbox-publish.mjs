/**
 * Internal: the publish command (publishCommand): classify the file, autofix and bundle a page,
 * journal the write, send it and save the canonical pair (toolbox-publish-finish.mjs); a publish
 * counts as activity in the page's comment watch (toolbox-comments.mjs).
 * Used by: publish.mjs, author-toolbox.test.ts, skill-examples.test.ts.
 */
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {prepareBundle} from './publication-bundle.mjs';
import {finishPublication} from './toolbox-publish-finish.mjs';
export {finishPublication};
import {ToolError,makeClient,selectedServer,serverOrigin,positional,enumValue,jsonFile,optionalFile,
  hash,platform,journalIntent,createJournal,resumeJournal,within} from './toolbox-client.mjs';
import {loadPair,sourceIdentity,UNPAIRED} from './toolbox-source.mjs';
import {noteWatchActivity} from './toolbox-comments.mjs';
const media={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
  '.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.txt':'text/plain','.css':
  'text/css','.js':'text/javascript','.woff2':'font/woff2'};
export async function publishCommand({values,positionals},options={}){
 if(values.resume){
positional(positionals,0);if(Object.keys(values).some(flag=>!['resume','server','json',
    'output'].includes(flag)))throw new ToolError('resume_overrides',
    'Resume accepts no changed source or write flags.',2);
const saved=await jsonFile(values.resume),server=serverOrigin(selectedServer(values,options.env)??
    saved.server);
const client=makeClient(server,options),done=await finishPublication(await resumeJournal(
    values.resume,client,'publish'));return watched(client,done,options);
 }
const file=await realpath(positional(positionals)),server=serverOrigin(selectedServer(values,
   options.env)),client=makeClient(server,options),bytes=await readFile(file),extension=
   path.extname(file).toLowerCase();
if(extension==='.ts')throw new ToolError('backend_requires_page',
   'Publish backend TypeScript through its declaring HTML page.',2);
const type=values.type?enumValue(values.type,['html','dataset','asset'],'type'):['.html',
   '.htm'].includes(extension)?'html':['.csv','.json'].includes(extension)?'dataset':media[
   extension]?'asset':null;
if(!type)throw new ToolError('type_required',
   'Ambiguous file type: supply --type html|dataset|asset.',2);
 let baseline=null,source=bytes.toString('utf8');
 const sidecar=await optionalFile(values.baseline??file+'.af.json');
 if(!values.create&&sidecar){
  if(type==='html')({baseline}=await loadPair(file,server,values.baseline));
  else{
baseline=JSON.parse(sidecar);if(baseline.kind!=='data-baseline'||baseline.server!==server||
     baseline.sourceFile!==path.basename(file)||baseline.historical||baseline.schema!==1||
     !/^[A-Za-z0-9]{6,12}$/.test(baseline.id??'')||!Number.isSafeInteger(baseline.version)||
     baseline.version<1||!/^[a-f0-9]{64}$/.test(baseline.state??''))throw new ToolError(
     'invalid_baseline','Data source requires a matching current-head companion.',2,
     'Publish the file its companion was saved with, or read.mjs ID --output fresh.json. Never '+
     'copy or hand-edit .af.json companions.');
  }
}else if(!values.create&&type==='html'&&(sourceIdentity(source)||
   /data-af\s*=\s*["'](?:portable|runtime|offline-source)|data-af-id\s*=/i.test(source.replace(
   /(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi,'$1$3'))))throw new ToolError(
   'baseline_missing',
   'This HTML has data-af-id attributes or an authoring marker but no companion '+path.basename(
   file)+'.af.json, so its page identity is unknown. For a new page, delete the data-af-id values '+
   'you wrote (publish adds its own) or rerun with --create.',2,UNPAIRED);
if(values.artifact){if(!baseline||!values.baseline)throw new ToolError('baseline_required',
   '--artifact requires --baseline; never infer a fresh head.',2);const {resolveTarget}=
   await import('./toolbox-client.mjs');if(resolveTarget(values.artifact,
   server).id!==baseline.id)throw new ToolError('identity_mismatch',
   'Artifact and baseline IDs differ.',2);}
if(values.baseline&&!baseline&&!values.create)throw new ToolError('baseline_missing',
   'The explicitly selected baseline is unavailable.',2);
if(values.create){if(type==='html'){const {recoverPortableSource}=await platform();source=
   recoverPortableSource(source)??source;}source=source.replace(
   /<!-- af-authoring:[A-Za-z0-9_-]+ -->/g,'');baseline=null;}
const root=await realpath(values.root??baseline?.root??path.dirname(file));if(!within(root,
   file))throw new ToolError('source_outside_root','Source is outside the selected project root.',
   2);
 const entryPath=path.relative(root,file).split(path.sep).join('/');let body,fixed=null;
 const log=options.log??(text=>process.stderr.write(text));
 if(type==='html'){
  // One autofix pass before anything is sent (lib/html-autofix); its fixes land in the file with
  // the canonical result.
const {autofixSource,autofixDetail}=await import('./autofix.mjs'),{formatAutofixReport}=
    await import('./preview-html.mjs');
  const published=new Set((baseline?.dependencyReceipts??[]).map(receipt=>receipt.path));
  fixed=autofixSource(source,{file,root,mapped:name=>published.has(name)});
  if(fixed.problems.length||values.strict&&fixed.fixes.length){
const report=formatAutofixReport(fixed,{file:path.basename(file),landed:
     'nothing published or written',routine:fixed.routine});log(report);
   throw new ToolError(fixed.problems.length?'autofix_refused':'autofix_strict',
    fixed.problems.length?`autofix found ${fixed.problems.length} problem(s) to fix by hand; `+
    'see the autofix report.':'--strict refuses fixable problems; see the autofix report.',2,
    fixed.problems.length?'Fix the listed lines, then publish again.':
    'Run without --strict to apply the fixes, or fix them by hand.',
    {autofix:autofixDetail(fixed,report)});
  }
  source=fixed.html;
const extra=values.manifest?await jsonFile(values.manifest):{};if(Object.keys(extra).some(key=>
    key!=='manifest')||extra.manifest!==undefined&&!Array.isArray(
    extra.manifest))throw new ToolError('invalid_manifest',
    'Manifest JSON supports only {manifest:[paths]}. Receipts belong in the baseline.',2);
const mappings=Object.fromEntries((baseline?.dependencyReceipts??[]).map(({path,...receipt})=>[path,
    receipt]));
const prepared=await prepareBundle({root,entry:entryPath,entryHtml:source,server,manifest:
    extra.manifest??[],mappings,retainedBackends:baseline?.retainedBackends??[]});body=
    prepared.body;
const {inspectPublicationBundle}=await platform();inspectPublicationBundle(body.html,
    body.publicationBundle,{resolvedBackendNames:(baseline?.retainedBackends??[]).map(link=>
    link.name)});
 }else if(type==='dataset'){
let dataset=source;if(extension==='.json'){try{dataset=JSON.parse(source);}catch{
    throw new ToolError('invalid_dataset','Dataset JSON is malformed.',2);}if(!Array.isArray(
    dataset)||dataset.some(row=>!row||typeof row!=='object'||Array.isArray(
    row)))throw new ToolError('invalid_dataset','JSON dataset must be an array of row objects.',2);}
  body={dataset};
}else body={file:{filename:baseline?.filename??path.basename(file),contentType:
   baseline?.contentType??media[extension]??'application/octet-stream',base64:bytes.toString(
   'base64')}};
if(baseline){delete body.visibility;body.expectedVersion=baseline.version;body.expectedState=
   baseline.state;}
 else body.visibility='unlisted';
if(values.visibility)body.visibility=enumValue(values.visibility,['private','unlisted','public'],
   'visibility');if(values.title!==undefined)body.title=values.title;
 // --group HANDLE: create the page directly in a group you can edit. The server refuses a
 // destination that conflicts with the parent's owner.
 if(values.group!==undefined){
if(baseline)throw new ToolError('group_not_for_update',
    '--group places a new page; it never moves an existing one.',2,
    'Drop --group (updates keep their owner) or use --create for a new page.');
  const detail=await client.request('/api/groups/'+encodeURIComponent(
    values.group.replace(/^@/,'')));
if(detail.group?.role!=='editor')throw new ToolError('group_not_editor',
    'Publishing into a group needs editor access in it.',3,
    'Ask a group editor for editor access, or publish without --group.');
  body.destination={type:'group',id:detail.group.id};
 }
 if(values['dry-run']){
const report=fixed&&(await import('./preview-html.mjs')).formatAutofixReport(fixed,{file:
    path.basename(file),landed:'dry run; nothing written',dryRun:true,routine:fixed.routine});if(
    report)log(report);
return {dryRun:true,...(body.destination?{destination:body.destination}:{}),...(fixed?{autofix:(
    await import('./autofix.mjs')).autofixDetail(fixed,report)}:{}),server,type,method:
    baseline?'PUT':'POST',artifact:baseline?.id??null,files:body.publicationBundle?.files.map(file=>
    ({path:file.path,contentType:file.contentType,bytes:Buffer.from(file.base64,
    'base64').length}))??[],note:
    'Local planning only; access, backend execution and rendering remain unverified.'};
 }
const intent=journalIntent({server,method:baseline?'PUT':'POST',path:'/api/artifacts'+(
   baseline?'/'+baseline.id:''),body,operation:'publish',source:{file,sha256:hash(bytes),root,
   entryPath},baseline});
intent.source.output=path.join(path.dirname(file),path.basename(file,
   extension)+'.canonical-'+intent.key.slice(0,8)+(type==='html'?'.html':extension||'.bin'));
 const journal=await createJournal(intent,{file:values.request,root:client.root,project:root});
 const done=await watched(client,await finishPublication(await resumeJournal(journal,client,
  'publish')),options);
 if(!fixed)return done;
const {autofixDetail}=await import('./autofix.mjs'),{formatAutofixReport}=await import(
   './preview-html.mjs');
const routine=[...fixed.routine,...routineChanges(source,await readFile(done.source,'utf8'),
   done.identity,baseline)];
const report=formatAutofixReport(fixed,{file:path.basename(file),landed:
   fixed.changed?done.updatedInPlace?`also written to ${path.basename(file)}`:
   `written to ${path.basename(done.source)}`:undefined,routine});log(report);
 // Exact-text edits written against the file as it was before publishing silently miss once ids
 // are added: say so where the agent reads (runTool prints it after the result).
 const ids=text=>(text.match(/\sdata-af-id\s*=/g)??[]).length,added=ids(await readFile(done.source,
  'utf8'))-ids(bytes.toString('utf8'));
 const rewritten=done.updatedInPlace&&added>0?`${path.basename(file)} was rewritten with ${added} `+
  'data-af-id attributes: re-read it before editing; match on short anchors, not whole lines.':null;
 return {...done,...(rewritten?{rewritten}:{}),autofix:autofixDetail({...fixed,routine},report)};
}
/** A publish resets the quiet time of the page's comment watch; it never fails the publish. */
async function watched(client,done,{now}={}){await noteWatchActivity(client.root,client.server,
  done.id,now).catch(()=>{});return done;}
/** Platform-owned changes the server made on publish, counted rather than listed: identities and
 * asset links. */
function routineChanges(sent,saved,identity,baseline){
const count=text=>(text.match(/\sdata-af-id\s*=/g)??[]).length,added=count(saved)-count(sent),
   changes=[];
if(identity&&identity.carried)changes.push(
   `carried forward ${identity.carried} data-af-id from v${identity.fromVersion}, ${
     identity.fresh} new`);
 else if(added>0)changes.push(`added ${added} data-af-id`);
const links=text=>[...text.matchAll(/\s(?:src|href|poster)\s*=\s*"([^"]*)"/g)].map(match=>match[1]),
   before=links(sent),after=links(saved);
if(before.length===after.length){const rewritten=before.filter((value,index)=>value!==after[
   index]).length;if(rewritten)changes.push(`rewrote ${rewritten} asset link${rewritten===1?'':
   's'}`);}
 return changes;
}
