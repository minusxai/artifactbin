/** One deployment-scoped monitor instruction for single-document read/write responses. */
export function monitoringGuidance(base:string,id:string,format:string):Record<string,unknown>{
 if(format!=='markup'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/monitoring`,
  cli:`afbin watch ${url} --server ${origin} --comments --json`,
  http:`${origin}/api/artifacts/${id}/annotations/changes?after=now&wait=60`,
  instruction:'Handle existing comments and continue the task. Monitor new human comments in one background process; never wait for it to exit. Without background support, use bounded HTTP polls between work steps. Follow the guide for replies, checkpoints and stopping.'}};
}
