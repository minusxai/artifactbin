/**
 * Internal: the publish command (publishCommand): classify the file, settle what it replaces from
 * its af-authoring marker (or --artifact, or --create), autofix and bundle a page, journal the
 * write, send it and save the canonical source (toolbox-publish-finish.mjs); a publish counts as
 * activity in the page's comment watch (toolbox-watch-state.mjs).
 * Used by: publish.mjs, author-toolbox.test.ts, skill-examples.test.ts.
 */
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {prepareBundle} from './toolbox-publication-bundle.mjs';
import {finishPublication} from './toolbox-publish-finish.mjs';
export {finishPublication};
import {ToolError,makeClient,selectedServer,serverOrigin,positional,enumValue,jsonFile,hash,
  platform,journalIntent,createJournal,resumeJournal,within,resolveTarget} from
  './toolbox-client.mjs';
import {refuseEmpty,placeholderProblems,headBaseline,markedBaseline,unmarked,emptyTable,
  updateNext} from './toolbox-publish-guard.mjs';
import {markerOf,stripMarker} from './toolbox-source.mjs';
import {noteWatchActivity,watchNext} from './toolbox-watch-state.mjs';
import {TEMPLATES,applyTemplate,routineChanges} from './toolbox-publish-dataset.mjs';
const media={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
  '.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.txt':'text/plain','.css':
  'text/css','.js':'text/javascript','.woff2':'font/woff2'};
export async function publishCommand({values,positionals},options={}){
 if(values.personal&&values.group!==undefined)throw new ToolError('invalid_destination',
   'Choose --personal or --group, not both.',2);
 if(values.resume){
positional(positionals,0);if(Object.keys(values).some(flag=>!['resume','server','json',
    'output'].includes(flag)))throw new ToolError('resume_overrides',
    'Resume accepts no changed source or write flags.',2);
const saved=await jsonFile(values.resume),server=serverOrigin(selectedServer(values,options.env)??
    saved.server);
const client=makeClient(server,options),done=await finishPublication(await resumeJournal(
    values.resume,client,'publish'));return watched(client,done,options);}
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
if(values.template!==undefined)enumValue(values.template,TEMPLATES,'template');
if((values.template!==undefined||values['owner-column']!==undefined)&&(type!=='dataset'||
   !values.template))throw new ToolError('template_requires_dataset',
   '--template (with --owner-column for own-rows) sets the permissions of a new dataset.',2,
   'For an existing dataset use policy.mjs template and set.');
if(values.name!==undefined&&type!=='dataset')throw new ToolError('name_requires_dataset',
   '--name sets a new dataset\'s GraphQL root name.',2);
 let baseline=null,source=bytes.toString('utf8'),replaced=null,marker=null;
 const target=values.artifact?resolveTarget(values.artifact,server).id:null,name=path.basename(
  file);
 // The marker is the baseline; --artifact ID replaces that page over its current head when the
 // marker is missing, broken or names another page; --create makes a new page of a file that
 // carries no marker of this server.
 if(type==='html')try{marker=markerOf(file,source,server);}catch(error){if(!target&&!values.create)
  throw error;}
 if(values.create&&marker)throw new ToolError('already_published',`${name} is already page `+
  `${marker.id}.`,2,`To update page ${marker.id}: node scripts/publish.mjs ${name}. For a second `+
  'page from it, delete its last line (the af-authoring marker) first.');
 // An update keeps its owner, permissions and GraphQL name: refused before anything is read.
 const updating=!values.create&&Boolean(target||marker);
 for(const flag of ['group','personal'])if(updating&&values[flag]!==undefined)throw new ToolError(
  flag+'_not_for_update',`--${flag} places a new page; it never moves an existing one.`,2,
  `Drop --${flag} (updates keep their owner) or use --create for a new page.`);
if(updating&&values.template)throw new ToolError('template_not_for_update',
   '--template applies only when a dataset is created.',2,
   'Use policy.mjs template ID and policy.mjs set ID for an existing dataset.');
if(updating&&values.name!==undefined)throw new ToolError('name_not_for_update',
   '--name applies only when a dataset is created; its GraphQL name never changes.',2,
   'Drop --name, or publish a new dataset with --create.');
 if(target&&marker?.id!==target&&!values.create){baseline=await headBaseline(client,target,type);
  replaced=`${name} replaced page ${target} (its version ${baseline.version} was the baseline).`;}
 else if(marker&&!values.create)baseline=await markedBaseline(client,marker,name,source);
 if(type==='html'&&!baseline&&!values.create)unmarked(source,name);
if(values.create){if(type==='html'){const {recoverPortableSource}=await platform();source=
   stripMarker(recoverPortableSource(source)??source);}baseline=null;}
 // The page's receipts are relative to the root it was published from: the marker's entryPath
 // says how far above the file that is.
 const up=baseline&&marker?.id===baseline.id?marker.entryPath.split('/').length-1:0;
 const root=await realpath(values.root??path.resolve(path.dirname(file),...Array(up).fill('..')));
 if(!within(root,file))throw new ToolError('source_outside_root',
  'Source is outside the selected project root.',2);
 const entryPath=path.relative(root,file).split(path.sep).join('/');let body,fixed=null;
 const log=options.log??(text=>process.stderr.write(text));
 if(type==='html'){
  // One autofix pass before anything is sent (lib/html-autofix); its fixes land in the file with
  // the canonical result.
const {autofixSource,autofixDetail}=await import('./autofix.mjs'),{formatAutofixReport}=
    await import('./preview-html.mjs');
  const published=new Set((baseline?.dependencyReceipts??[]).map(receipt=>receipt.path));
  refuseEmpty(source,file);
  fixed=autofixSource(source,{file,root,mapped:name=>published.has(name),newPage:!baseline});
  fixed.problems=[...fixed.problems,...placeholderProblems(source)].sort((a,b)=>a.line-b.line);
  if(fixed.problems.length||values.strict&&fixed.fixes.length){
const report=formatAutofixReport(fixed,{file:path.basename(file),landed:
     'nothing published or written',routine:fixed.routine});log(report);
   throw new ToolError(fixed.problems.length?'autofix_refused':'autofix_strict',
    fixed.problems.length?`autofix found ${fixed.problems.length} problem(s) to fix by hand; `+
    'see the autofix report.':'--strict refuses fixable problems; see the autofix report.',2,
    fixed.problems.length?'Fix the listed lines, then publish again.':
    'Run without --strict to apply the fixes, or fix them by hand.',
    {autofix:autofixDetail(fixed,report)});}
  source=fixed.html;
const extra=values.manifest?await jsonFile(values.manifest):{};if(Object.keys(extra).some(key=>
    key!=='manifest')||extra.manifest!==undefined&&!Array.isArray(
    extra.manifest))throw new ToolError('invalid_manifest',
    'Manifest JSON supports only {manifest:[paths]}. Receipts come from the page.',2);
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
  body={dataset,...emptyTable(extension,dataset)};
}else body={file:{filename:baseline?.filename??path.basename(file),contentType:
   baseline?.contentType??media[extension]??'application/octet-stream',base64:bytes.toString(
   'base64')}};
if(baseline){delete body.visibility;body.expectedVersion=baseline.version;body.expectedState=
   baseline.state;}
 // A visibility change on an update names the sharing revision it saw, when the baseline has one.
 if(baseline&&values.visibility&&Number.isSafeInteger(baseline.sharingRevision))
  body.expectedSharingRevision=baseline.sharingRevision;
 else body.visibility='unlisted';
if(values.visibility)body.visibility=enumValue(values.visibility,['private','unlisted','public'],
   'visibility');if(values.title!==undefined)body.title=values.title;
 // A new dataset is named after its file (sales.csv → sales), the name a page links it by.
 const stem=path.basename(file).replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'_')
  .replace(/^_+|_+$/g,''),named=/^(?!dataset|true$|false$|null$)[a-z][a-z0-9_]{0,40}$/;
 if(values.name!==undefined)body.name=values.name;
 else if(type==='dataset'&&!baseline&&named.test(stem))body.name=stem;
 if(values.personal)body.destination={type:'personal'};
 // --group HANDLE: create the page directly in a group you can edit. The server refuses a
 // destination that conflicts with the parent's owner.
 if(values.group!==undefined){
  const detail=await client.request('/api/groups/'+encodeURIComponent(
    values.group.replace(/^@/,'')));
if(detail.group?.role!=='editor')throw new ToolError('group_not_editor',
    'Publishing into a group needs editor access in it.',3,
    'Ask a group editor for editor access, or publish without --group.');
  body.destination={type:'group',id:detail.group.id};}
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
 const published=await watched(client,await finishPublication(await resumeJournal(journal,client,
  'publish')),options);
 // A page's author ends by replying and watching for comments: say so as the last line printed.
 const done={...published,...(replaced?{note:[replaced,published.note].filter(Boolean).join(' ')}:
  {}),next:type==='html'?watchNext(published.id):updateNext(name,published.id,type)};
 if(type==='dataset'&&values.template)return {...done,permissions:await applyTemplate(client,
  done.id,values.template,values['owner-column'])};
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
