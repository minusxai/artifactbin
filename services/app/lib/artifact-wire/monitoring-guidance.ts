/** How long a watch waits with no comment, reply or save before it ends: the skill's `watch --next` stops after the
 * same quiet time (scripts/toolbox-comments.mjs QUIET_MINUTES; agent-starter-consistency pins they agree). */
const QUIET_MINUTES = 15;
/** One deployment-scoped monitor instruction for single-document read/write responses. */
export function monitoringGuidance(base:string,id:string,format:string):Record<string,unknown>{
 if(format!=='markup'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/monitoring`,
  http:`${origin}/api/artifacts/${id}/annotations/changes?after=now&wait=60`,
  instruction:`After the first successful save or local preview, write your full reply first, then start one comment monitor automatically; do not ask first. Handle existing comments and continue the task. Answer each comment (a requested change is part of your task: save it, then reply), then watch again. Stop after ${QUIET_MINUTES} minutes with no comment, reply or save from anyone and end your turn; a later watch starts a new ${QUIET_MINUTES} minutes. Use a tool that wakes you on each output line, not as a plain background job whose output nobody reads; never wait for it to exit. Without such a tool, make bounded polls between work steps and tell the user monitoring stops when your work ends. Follow the guide for replies and checkpoints.`}};
}
