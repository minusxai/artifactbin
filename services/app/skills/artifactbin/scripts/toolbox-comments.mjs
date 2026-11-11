/**
 * Internal: the comment stream of the events watch: text rendering of comments and reactions,
 * and watchComments, the events watch (toolbox-events.mjs) on one page's comments category,
 * bounded, with the comment presenter: comments, replies, edits and reactions from others wake
 * it, each printed with the comment's words from the comment read (events carry ids, never
 * text), threads waiting for your answer are computed here from events plus that read, and
 * comment.mjs (options.replyFirst) holds every call at once while the reply to the user is owed.
 * Used by: comment.mjs, author-toolbox, comment-reactions-toolbox and agent-sessions tests; the
 * log state and lock live in toolbox-watch-state.mjs.
 */
import {watchEvents} from './toolbox-events.mjs';
import {openThreads,QUIET,REACTIONS,replyDueLine} from './toolbox-watch-state.mjs';
export {noteWatchActivity,QUIET_MINUTES,REACTIONS} from './toolbox-watch-state.mjs';
const REACTION_MARKS={thumbs_up:'👍'};
/** One reaction summary for reading: "👍 ppsreejith, alice", "+N" past the listed reactors, or
 * the bare count from an older server. */
export function reactionText(reaction){
const mark=REACTION_MARKS[reaction?.kind]??String(reaction?.kind),by=Array.isArray(
   reaction?.by)?reaction.by:null;
 if(!by)return `${mark} ${reaction?.count??0}`;
const names=by.map(reactor=>reactor?.label||(reactor?.kind==='agent'?'agent':'someone')),more=(
   reaction.count??names.length)-names.length;
 return `${mark} ${names.join(', ')}${more>0?` +${more}`:''}`;
}
/** A comment listing as text output shows it: each comment's reactions as reactionText lines.
 * --json keeps the structure. */
export function listText(page){
 if(!Array.isArray(page?.annotations))return page;
return {...page,annotations:page.annotations.map(annotation=>({...annotation,thread:Array.isArray(
   annotation.thread)?annotation.thread.map(comment=>Array.isArray(comment.reactions)?{...comment,
   reactions:comment.reactions.map(reactionText)}:comment):annotation.thread}))};
}
/** The comments category's event types that put words on a thread, and a reaction change. */
const WRITES=new Set(['artifact.annotated','artifact.annotation_replied',
  'artifact.annotation_edited']);
const REACTION='artifact.annotation_reaction_changed';
/** Threads, from events: the thread a comment write is on, the thread a resolve or a whole-thread
 * delete closes, and which of some threads a listing finds closed. */
export const COMMENT_THREADS={
 of:event=>WRITES.has(event?.type)?event.payload?.annotation_id??null:null,
 closes:event=>event?.type==='artifact.annotation_resolved'||(event?.type===
  'artifact.annotation_deleted'&&!event.payload?.reply_id)?event.payload?.annotation_id??null:null,
 open:openThreads};
const commentOf=event=>event?.payload?.reply_id??event?.payload?.annotation_id;
/** Each record's comment from the comment read (status=all, every page): {id,thread,status,body,
 * author:{kind,label},created_at,edited_at}. A comment it cannot read (deleted, access lost, an
 * unreadable listing) leaves the record as it was. */
async function withComments(client,id,records,signal){
 const wanted=new Set(records.map(({event})=>commentOf(event)).filter(Boolean));
 if(!wanted.size)return records;
 const found=new Map();let cursor=null;
 try{for(let page=0;page<20&&found.size<wanted.size;page++){
  const listed=await client.request(`/api/artifacts/${id}/annotations?`+new URLSearchParams({
   status:'all',limit:'100',...(cursor?{cursor}:{})}),{signal});
  if(!Array.isArray(listed?.annotations))break;
  for(const thread of listed.annotations)for(const comment of thread.thread??[])if(wanted.has(
   comment.id))found.set(comment.id,{id:comment.id,thread:thread.id,status:thread.status,
   body:comment.body,author:{kind:comment.author?.kind,label:comment.author?.label??null},
   created_at:comment.created_at,...(comment.edited_at?{edited_at:comment.edited_at}:{})});
  cursor=listed.next_cursor;if(!cursor)break;}}catch{/* The events alone are still printed. */}
 return records.map(record=>found.has(commentOf(record.event))?{...record,
  comment:found.get(commentOf(record.event))}:record);
}
/** The comment presenter of one page: what wakes, what is printed and the closing lines. */
function comments(id){
 const quietLine=QUIET,answer='do what it asks, even past limits an earlier request set '+
  `(publish the change first), then node scripts/comment.mjs reply ${id} --thread`;
 return {threads:COMMENT_THREADS,wakes:event=>WRITES.has(event.type)||event.type===REACTION,
  reaction:event=>event.type===REACTION,
  hydrate:(records,{client,signal})=>withComments(client,id,records,signal),
  lines:{replaced:'a newer watch --next on this page took over and prints the next comments; '+
    'this one stopped: nothing to do here',quiet:quietLine,
   stopped:quiet=>`no new comments for ${quiet}: stop watching and end your turn; if the `+
    'person asks you to watch again, run watch --next',
   once:'--once waited for nothing; to watch for new comments: node scripts/comment.mjs '+
    `watch ${id} --next`,
   unanswered:threads=>`answer the comment(s) printed above first (${threads.join(', ')}): `+
    `${answer} THREAD --body TEXT; then run watch --next again`,
   // Agents re-watched before replying and missed the person's wait: print the order here.
   next:reacted=>`next: answer each comment above: ${answer} <annotation_id> --body TEXT; the `+
    'reply prints how to watch again.'+(reacted?' '+REACTIONS:''),
   replyDue:server=>replyDueLine(server,id)}};
}
/** comment.mjs watch: `events watch --artifact ID --category comments --bounded`, presented as
 * comments (see watchEvents for --next, --once, logs and checkpoints). */
export function watchComments(client,id,values,options={}){
 return watchEvents(client,{artifact:id,category:'comments'},{...values,bounded:true},options,
  comments(id));
}
