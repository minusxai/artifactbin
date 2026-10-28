/** One deployment-scoped monitor instruction for single-document read/write responses. */
export function monitoringGuidance(base:string,id:string,format:string):Record<string,unknown>{
 if(format!=='markup'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/monitoring`,
  http:`${origin}/api/artifacts/${id}/annotations/changes?after=now&wait=60`,
  instruction:'After the first successful save or local preview, start one comment monitor automatically; do not ask first. Keep it active until the session ends or the user says stop. Handle existing comments and continue the task. Use a tool that wakes you on each output line, not as a plain background job whose output nobody reads; never wait for it to exit. Without such a tool, make bounded polls between work steps and tell the user monitoring stops when your work ends. Follow the guide for replies, checkpoints and stopping.'}};
}
