/** The comment feed's events (people's and agents' comments and reactions), mapped once for both producers. */
import type {CommentChangeEvent,CommentReactionChangeEvent,CommentReactionKind} from '@artifactbin/contracts';

/** One row of a comment feed, as either producer (hosted SQL, the local workspace store) holds it. Positions share one sequence. */
export interface CommentFeedRow {
 id:string;rootId:string|null;authorKind:string;label:string|null;userId:string|null;body:string;createdAt:string;editedAt:string|null;
 /** Where the comment was created, and where it now sits: its creation, or its latest edit. */
 seq:bigint;key:bigint;
 /** Written (or last rewritten) with the credential reading the feed. */
 you:boolean;
}
/**
 * THE ONE MAPPING from a feed row to its event, for a reader at position `from`: a comment created past it is the plain
 * new-comment event with its current words; one created before it and since edited is an edit event with its own ID.
 * People's and agents' comments alike; authorship is data (`author.kind`, `author.you`). Both producers call this; the
 * shape cannot drift between them.
 */
export function commentChangeEvent(row:CommentFeedRow,artifactId:string,from:bigint):CommentChangeEvent{
 const created=row.seq>from;
 const kind=row.authorKind==='agent'?'agent' as const:'human' as const;
 return {type:'artifactbin.comment',event_id:created?row.id:`${row.id}:${row.key}`,artifact_id:artifactId,annotation_id:row.rootId??row.id,comment_id:row.id,
  author:{kind,label:row.label,user_id:kind==='agent'?null:row.userId,you:row.you},body:row.body,created_at:row.createdAt,
  ...(created?{}:{change:'edited' as const,edited_at:row.editedAt??row.createdAt})};
}

/** One effective reaction change as the hosted log holds it (`comment_reaction_events`), at its feed position. */
export interface ReactionFeedRow {
 seq:bigint;commentId:string;rootId:string|null;userId:string;kind:CommentReactionKind;active:boolean;
 reactorKind:string;label:string|null;count:number;createdAt:string;
 /** Made with the credential reading the feed. */
 you:boolean;
}
/**
 * THE ONE MAPPING from the reaction changes a reader at some position has not seen (oldest first) to events, each at
 * the position it sits at. Per account, comment and kind the log alternates, so the state at the reader's position is
 * the opposite of the first change past it: when the last change restores that state (added then taken back, or taken
 * back then added again) nothing changed for this reader and there is no event; otherwise the last change is the one
 * event, with its count. A person's and an agent's reactions alike; the reactor is drawn as a comment author is.
 */
export function reactionChangeEvents(rows:readonly ReactionFeedRow[],artifactId:string):{seq:bigint;event:CommentReactionChangeEvent}[]{
 const groups=new Map<string,ReactionFeedRow[]>();
 for(const row of rows){const key=JSON.stringify([row.commentId,row.userId,row.kind]);const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
 return [...groups.values()].flatMap(group=>{
  const first=group[0]!,last=group[group.length-1]!;
  if(first.active!==last.active)return [];
  const kind=last.reactorKind==='agent'?'agent' as const:'human' as const;
  return [{seq:last.seq,event:{type:'artifactbin.comment_reaction' as const,event_id:`${last.commentId}:reaction:${last.seq}`,artifact_id:artifactId,
   annotation_id:last.rootId??last.commentId,comment_id:last.commentId,change:last.active?'added' as const:'removed' as const,kind:last.kind,count:last.count,
   reactor:{kind,label:last.label,user_id:kind==='agent'?null:last.userId,you:last.you},created_at:last.createdAt}}];
 }).sort((a,b)=>a.seq<b.seq?-1:a.seq>b.seq?1:0);
}
