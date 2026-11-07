/**
 * Internal: the short text digest check.mjs always prints (--output also saves the full JSON),
 * ending on a clean pass with the facts for the reply and the watch line.
 * Used by: toolbox-client.mjs (runTool; re-exported as checkDigest), author-toolbox.test.ts.
 */
import {replyNext} from './toolbox-watch-state.mjs';

/** One line per viewport so a saved check needs no second call to read it; the file keeps full
 * evidence. */
export function checkDigest(envelope,file){
 const clip=(value,n)=>{const text=typeof value==='string'?value:JSON.stringify(value);
  return text.length>n?text.slice(0,n)+'…':text;};
 const lines=[];
 // Problems autofix cannot fix in a local preview come first: the browser evidence below may
 // follow from them.
 const autofix=envelope.autofix;
 if(autofix?.problems?.length){
  lines.push(`autofix: ${autofix.problems.length} problem${autofix.problems.length===1?'':
   's'} to fix by hand`);
  for(const problem of autofix.problems.slice(0,5))lines.push(
   `  ${autofix.file??'page'}:${problem.line}:${problem.column} ${problem.message}`);
  if(autofix.problems.length>5)lines.push(`  … and ${autofix.problems.length-5} more`);
 }
 // A clean pass needs nothing from the saved JSON, so only a failure names the file.
 const clean=envelope.smokePassed&&(envelope.checks??[]).every(check=>check?.viewport&&
  check.steps&&!check.error&&!check.contrast?.belowAA&&!check.slides?.clipped&&
  !check.slides?.overlapping&&!check.idStability?.unstable);
 lines.push(`check ${envelope.ok?'completed':envelope.code}: smoke ${envelope.smokePassed?'passed':
  'failed'}${file&&!clean?`; full result ${file}`:''}`);
 for(const check of envelope.checks??[]){
  if(!check?.viewport){lines.push('  '+clip(check?.error??check,240));continue;}
  const errors=['pageErrors','consoleErrors','failedRequests','httpErrors'].filter(key=>check[
   key]?.length).map(key=>`${key} ${check[key].length}: ${clip(check[key][0],160)}`);
  if(check.ids?.duplicates)errors.push(
   `duplicate data-af-id ${check.ids.duplicates}: ${check.ids.items.map(item=>
    `${clip(item.id,60)} x${item.count}`).join(', ')}${
    check.ids.duplicates>check.ids.items.length?
     `; +${check.ids.duplicates-check.ids.items.length} more`:''}`);
  const blocked=check.needsSecret,task=check.error?'task error: '+clip(check.error,1000):
   blocked&&'step' in blocked?`steps stopped ${blocked.step==null?'outside a step':'at '+
    JSON.stringify(blocked.step)}: needs secret ${blocked.secrets.join(', ')}`:
   check.inspectionError?'inspection error: '+clip(check.inspectionError,200):
   check.task==null?(check.steps?.passed?'steps passed':'no task'):'task '+clip(check.task,2000);
  const overflow=check.overflow?check.overflow.fits?'fits':
   `overflow ${check.overflow.content}>${check.overflow.viewport}${
    check.overflow.culprits?.length?' from '+check.overflow.culprits.map(c=>
     `${c.element} (right ${c.right})`).join(', '):''}`:'overflow unknown';
  // List every defect (up to 12 of each kind), by text and element or slide, so a fix needs no
  // trip into the JSON.
  const few=(items,show,n=12,total=items?.length??0)=>(items??[]).slice(0,n).map(show).join('; ')+(
   total>n?`; +${total-n} more`:'');
  const slides=!check.slides?'':
   `; slides ${check.slides.count} exportable, ${check.slides.clipped?
    `${check.slides.clipped} clipped (${few(check.slides.items,cut=>
     `slide ${cut.slide} "${cut.text}" by ${cut.by} ${cut.px}px`,12,check.slides.clipped)})`:
    'none clipped'}${check.slides.overlapping?
    `, ${check.slides.overlapping} overlapping (${few(check.slides.overlaps,o=>
     `slide ${o.slide} "${o.text}" over "${o.over}"`,12,check.slides.overlapping)})`:''}`;
  const contrast=check.contrast?check.contrast.belowAA?
   `contrast ${check.contrast.belowAA} below AA (${check.contrast.unreadable} under 2:1; ${
    few(check.contrast.low,low=>`${low.ratio}:1 "${low.text}"${low.element?' '+low.element:''}${
     low.slide?' slide '+low.slide:''}${low.color?' '+low.color:''}`,12,
     check.contrast.belowAA)})`:'contrast ok':'contrast unknown';
  const who=check.viewer?check.viewer+' ':'';
  lines.push(`  ${who}${check.viewport.width}x${check.viewport.height}: ${errors.length?
   errors.join('; '):'no errors'}; ${overflow}; ${contrast}${slides}; ${task}`);
 }
 // Script-created IDs that differ between two loads break saved comments; a warning, not a smoke
 // failure.
 for(const check of envelope.checks??[]){
  const stability=check?.idStability;
  if(stability?.unstable)lines.push(
   `  warning: ${stability.unstable} script-created data-af-id differ between loads (${
    stability.sample.map(id=>clip(id,60)).join(', ')}); derive them from record IDs, not index, `+
   'text or random values.');
  else if(stability?.skipped)lines.push('  warning: '+clip(stability.skipped,160));
 }
 // A linked dataset no viewport read: the page shows typed-in numbers, not the rows.
 for(const {name} of envelope.unreadDatasets??[])lines.push(`  page links dataset ${clip(name,60)
  } but never reads it on load or in your steps: compute its numbers from its rows in page `+
  'script (references/datasets.md#read)');
 // Each failed GraphQL field with what the server told the owner; an unset secret is Not tested.
 for(const failure of (envelope.graphqlFailures??[]).slice(0,5))lines.push('  '+failed(failure));
 if(!(clean&&envelope.reply))for(const item of envelope.needsSecrets??[])lines.push(
  '  Not tested: '+untested(item));
 // What the step labels proved, per viewport: the Tested: line of the reply facts.
 const done=(envelope.checks??[]).filter(c=>c?.viewport&&c.verified?.length&&!c.error);
 const tested=done.map(c=>`${c.viewer?c.viewer+' ':''}${c.viewport.width}x${c.viewport.height}: ${
  c.verified.join('; ')}`).join(' | ');
 if(!(envelope.smokePassed&&done.length)&&envelope.unverified?.length)lines.push(
  '  unverified: '+envelope.unverified.join(', '));
 const shots=(envelope.checks??[]).map(c=>c?.screenshot).filter(s=>s?.path).map(s=>s.path+(
  s.partial?` (${s.partial})`:''));
 if(shots.length)lines.push('  screenshots: '+shots.join(', '));
 if(envelope.smokePassed&&!(envelope.checks??[]).some(check=>check?.steps))lines.push(
  '  no steps ran: this only shows the page loads; test the requested behaviour with --steps.');
 else if(clean&&!envelope.reply)lines.push('  clean pass on the local preview; a check of the'+
  ' published page prints the facts for your reply.');
 else if(clean)lines.push('  clean pass: nothing left to fix.',...replyFacts(envelope,tested));
 else if((envelope.checks??[]).length)lines.push(
  '  fix what is named above, then run the check again.');
 return lines.join('\n')+'\n';
}
/** One failed GraphQL field: the owner detail, or for a guest the code and what the owner gets. */
const failed=({field,message,code,detail,guest,ownerDetail,ownerPasses,notReplayed})=>`${
 code?.startsWith('backend_')?'resolver':'GraphQL'} ${field} failed${detail?`: ${detail} (owner `+
 'detail)':guest?` for the guest (${code??message}); ${ownerDetail?'as owner the detail is: '+
 ownerDetail:ownerPasses?'as owner it succeeds':notReplayed?'not a read-only query, so it was '+
 'not run again as owner':'no owner detail'}`:`: ${message}${code?` (${code})`:''}`}`;
/** What an unset resolver secret kept the check from testing, and who sets it. */
const untested=({step,fields,secrets})=>`${step===undefined?'resolver '+fields.join(', '):step===
 null?'the steps':JSON.stringify(step)} (needs secret ${secrets.join(', ')}, which the owner `+
 "sets in the page's Resolvers settings)";
/** A clean pass whose steps proved no labelled behaviour still proves each viewport loads. */
const loads=checks=>(checks??[]).filter(c=>c?.viewport).map(c=>`${c.viewer?c.viewer+' ':''}${
 c.viewport.width}x${c.viewport.height}: the page loads without errors`).join(' | ');
/** The facts a reply states, from the run and the page: the link, Built with, Tested, Not tested,
 * who can do what (the server's permission read-back, verbatim) and the slide images; then the
 * Next line. */
function replyFacts({reply,slideLinks,checks,needsSecrets},tested){
 const guest=(checks??[]).some(check=>check?.viewer==='guest'),many=reply.permissions.length>1;
 const untried=[...(needsSecrets??[]).map(untested),'visual appearance',...(guest?
  ['sharing between two signed-in users (the guest is signed out)']:[])];
 return ['For your reply:','Link: '+reply.link,
  ...(reply.builtWith?['Built with: '+reply.builtWith]:[]),'Tested: '+(tested||loads(checks)),
  'Not tested: '+untried.join('; '),
  ...(reply.permissions.length?['Who can do what:',...reply.permissions.flatMap(({name,id,lines})=>
   [...(many?[`${name} (ref:${id}):`]:[]),...lines])]:[]),
  ...(slideLinks?.length?['Slide images:',...slideLinks]:[]),'',replyNext(reply.id)];
}
