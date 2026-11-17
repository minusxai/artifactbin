/** The installation count ceiling, shared by human tokens and cumulative group workload storage. */
import {ARTIFACT_QUOTA_PER_TOKEN,registerTestOverride} from '@/lib/platform';
let override:number|null=null;
export function setArtifactQuotaForTests(cap:number|null):void{override=cap;}
registerTestOverride(()=>{override=null;});
export const artifactQuotaLimit=():number=>override??ARTIFACT_QUOTA_PER_TOKEN;
