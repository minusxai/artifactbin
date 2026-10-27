/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import ThumbsUp from 'lucide-solid/icons/thumbs-up';
import type { AnnotationCommentWire, CommentReactionSummary } from '@artifactbin/contracts';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
/**
 * Who reacted, as the thread names its authors: a person by handle, an agent by its label. Beyond the listed reactors
 * the exact count says how many more. Empty when the server sent no reactors (an older server, an offline file).
 */
export function reactorNames(reaction:CommentReactionSummary|undefined):string{
 const by=reaction?.by??[];if(!by.length)return '';
 const listed=by.map(reactor=>reactor.label?.trim()||(reactor.kind==='agent'?'Agent':'Someone'));
 const more=Math.max(0,reaction!.count-listed.length);
 return listed.join(', ')+(more?` and ${more} more`:'');
}
/** Compact per-kind group. A future picker can add kinds without changing the account/kind contract. */
export function CommentReactions(props:{comment:AnnotationCommentWire; signedIn:boolean; unavailable:string|null; onSignIn:()=>void; onReact:(active:boolean)=>Promise<void>}):JSX.Element {
 const reaction=()=>props.comment.reactions?.find(item=>item.kind==='thumbs_up');
 const active=()=>reaction()?.viewer_reacted===true;
 const count=()=>reaction()?.count??0;
 const [busy,setBusy]=createSignal(false),[error,setError]=createSignal('');
 const label=()=>props.unavailable??(!props.signedIn?'Sign in to react':active()?'Remove thumbs-up reaction':'React with thumbs up');
 const names=()=>reactorNames(reaction());
 const react=async()=>{
  if(busy()||props.unavailable)return;
  if(!props.signedIn){props.onSignIn();return;}
  setBusy(true);setError('');
  try{await props.onReact(!active());}
  catch{setError('Could not update your reaction. Try again.');}
  finally{setBusy(false);}
 };
 return <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
  <Tooltip content={names()?<span class="flex flex-col"><span>{label()}</span><span class="text-faint">{names()}</span></span>:label()}>
   <Button type="button" variant="ghost" size="sm" pressed={active()} aria-label={`${label()}${count()?` (${count()})`:''}${names()?`: ${names()}`:''}`} aria-busy={busy()} disabled={busy()||!!props.unavailable}
    onClick={()=>void react()} class="gap-1.5 rounded-chip font-sans text-2xs tabular-nums">
    <ThumbsUp size={13} strokeWidth={1.75} aria-hidden="true" />
    <Show when={count()}><span>{count()}</span></Show>
   </Button>
  </Tooltip>
  <Show when={error()}><span role="alert" class="text-2xs text-danger">{error()}</span></Show>
 </div>;
}
