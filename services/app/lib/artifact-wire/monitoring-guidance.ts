/** How long a watch waits with no comment, reply or save before it ends: the skill's `watch --next` stops after the
 * same quiet time (scripts/toolbox-comments.mjs QUIET_MINUTES; agent-starter-consistency pins they agree). */
const QUIET_MINUTES = 15;
/** THE watch loop, word for word in the monitor instruction below and in the served guide's "Watch for comments"
 * section (references/html-operations.md); agent-starter-consistency fails when the two drift apart. */
export const WATCH_LOOP = `answer each comment (save a requested change, then reply), then watch again; stop after ${QUIET_MINUTES} minutes with no comment, reply or save from anyone`;
/** One deployment-scoped monitor instruction for single-document read/write responses. One mode for every harness:
 * a blocking request, handled, then repeated — the same loop as the skill's foreground `watch --next`. */
export function monitoringGuidance(base:string,id:string,format:string):Record<string,unknown>{
 if(format!=='html'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/html-operations#watch-for-comments`,
  http:`${origin}/api/artifacts/${id}/annotations/changes?after=now&wait=60`,
  instruction:`After publishing page content, reply and start the monitor in the same response; do not ask first. The monitor is one blocking request at a time to the http URL (it waits up to 60 s), run in the foreground: handle what it returns, then request again from its next_cursor. Handle existing comments and continue the task: ${WATCH_LOOP}, and end your turn; a later watch starts a new ${QUIET_MINUTES} minutes. Follow the guide for replies and checkpoints.`}};
}
