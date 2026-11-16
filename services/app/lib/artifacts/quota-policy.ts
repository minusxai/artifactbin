/** The installation count ceiling, shared by human tokens and cumulative group workload storage. */
import {ARTIFACT_QUOTA_PER_TOKEN} from '@/lib/platform';
let override:number|null=null;
export function setArtifactQuotaForTests(cap:number|null):void{override=cap;}
export const artifactQuotaLimit=():number=>override??ARTIFACT_QUOTA_PER_TOKEN;
