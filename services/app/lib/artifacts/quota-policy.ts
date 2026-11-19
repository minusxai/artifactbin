/** The installation count ceiling a token's artifacts are held to. */
import {ARTIFACT_QUOTA_PER_TOKEN,registerTestOverride} from '@/lib/platform';
let override:number|null=null;
export function setArtifactQuotaForTests(cap:number|null):void{override=cap;}
registerTestOverride(()=>{override=null;});
export const artifactQuotaLimit=():number=>override??ARTIFACT_QUOTA_PER_TOKEN;
