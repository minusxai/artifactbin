/** One deployment-scoped monitor instruction for single-document read/write responses. */
export function monitoringGuidance(base:string,id:string,format:string):Record<string,unknown>{
 if(format!=='markup'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/monitoring`,
  cli:`afbin watch ${url} --server ${origin} --comments --json`,
  http:`${origin}/api/artifacts/${id}/annotations/changes?after=now&wait=60`,
  instruction:'Handle existing comments and continue the task. Monitor new human comments only when requested, with one watch started by a tool that wakes you on each output line, not as a plain background job whose output nobody reads; never wait for it to exit. During a requested review without such a tool, make bounded polls between work steps. Follow the guide for replies, checkpoints and stopping.'}};
}
