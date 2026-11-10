/** How long a watch waits with no comment, reply or save before it ends: the skill's `watch --next` stops after the
 * same quiet time (scripts/toolbox-watch-state.mjs QUIET_MINUTES; agent-starter-consistency pins they agree). */
const QUIET_MINUTES = 15;
/** THE watch loop, word for word in the monitor instruction below and in the served guide's "Watch for comments"
 * section (references/html-operations.md); agent-starter-consistency fails when the two drift apart. */
export const WATCH_LOOP = `answer each comment (save a requested change, then reply), then watch again; stop after ${QUIET_MINUTES} minutes with no comment, reply or save from anyone`;
/** One deployment-scoped monitor instruction for single-document read/write responses and a new comment's response
 * (`after: 'comment'`: an agent that commented watches for the answers just as one that published does). One mode for
 * every harness: a blocking request, handled, then repeated — the same loop as the skill's foreground `watch --next`. */
export function monitoringGuidance(base:string,id:string,format:string,after:'publish'|'comment'='publish'):Record<string,unknown>{
 if(format!=='html'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/html-operations#watch-for-comments`,
  http:`${origin}/api/events?artifact_id=${id}&category=comments&after=now&wait=30`,
  instruction:`${after==='comment'?'After commenting':'After publishing page content'}, send your reply, then start the monitor; do not ask first. The monitor is one blocking request at a time to the http URL (it waits up to 30 s): handle what it returns, then request again with its next as after. Handle existing comments first, then: ${WATCH_LOOP}, and end your turn; a later watch starts a new ${QUIET_MINUTES} minutes. The guide covers replies and checkpoints.`}};
}
