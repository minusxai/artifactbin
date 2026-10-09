/** One deployment-scoped monitor instruction for single-document read/write responses. */
export function monitoringGuidance(base:string,id:string,format:string):Record<string,unknown>{
 if(format!=='markup'&&format!=='folder')return {};
 const origin=base.replace(/\/$/,''),url=`${origin}/a/${id}`;
 return {monitoring:{artifact_url:url,guide:`${origin}/llms/monitoring`,
  cli:`afbin watch ${url} --server ${origin} --comments --json`,
  http:`${origin}/api/artifacts/${id}/annotations/changes?after=now&wait=60`,
  instruction:'Monitor this artifact for new human comments while working. Reuse one active monitor; follow the guide for HTTP, replies, restart and stopping.'}};
}
