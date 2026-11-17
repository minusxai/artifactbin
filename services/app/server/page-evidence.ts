/** Fixed auth-owner seam, behind identity's public internal-path refusal. Caller is the verified actual
 * human. The second call computes canonical schema/policy identities only, never repeats row SQL.
 * Fingerprints are internal digests, cannot authorize a read, and are never delivered by identity.
 */
import {ARTIFACT_WORKLOAD_LIMIT,isPageEvidenceOperation,type Actor} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody} from '@artifactbin/utils';
import {SQL_READ_WALL_TIMEOUT_MS} from '@/lib/platform';
import {identityForUser} from '@/lib/accounts';
import {pageEvidenceStep,preparePageEvidence} from '@/lib/page-doors';
import {withReadOnlyAccessFacts} from '@/lib/artifact-access';
export async function personalPageEvidence(request:Request,caller:Actor|null|undefined){
 if(caller?.credential!=='session'||!caller.userId||caller.tokenId||caller.sessionId)return Response.json({error:'forbidden'},{status:403});
 try{
  request=new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(SQL_READ_WALL_TIMEOUT_MS)])});
  const input=JSON.parse(await pageEvidenceStep(request.signal,readBody(request,{limit:ARTIFACT_WORKLOAD_LIMIT+8192,as:'text'})));
  if(!input||!isPageEvidenceOperation(input.operation)||Object.keys(input).some(k=>!['operation','fingerprint'].includes(k))||input.fingerprint!==undefined&&(typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint)))return Response.json({error:'bad_request'},{status:400});
  const actor=identityForUser(caller.userId),operation=input.fingerprint?{kind:'page-evidence-schema' as const,pageId:input.operation.pageId,revision:input.operation.revision}:input.operation;
  const result=await pageEvidenceStep(request.signal,withReadOnlyAccessFacts(()=>preparePageEvidence(request,actor,operation)));
  if(result.status!==200)return new Response(result.encoded,{status:result.status,headers:{'content-type':'application/json'}});
  await pageEvidenceStep(request.signal,withReadOnlyAccessFacts(()=>result.verify()));
  if(input.fingerprint)return Response.json({valid:result.fingerprint===input.fingerprint},{status:result.fingerprint===input.fingerprint?200:409});
  return Response.json({body:result.encoded,fingerprint:result.fingerprint});
 }catch(error){return Response.json({error:error instanceof BodyTooLargeError?'too_large':'not_found'},{status:error instanceof BodyTooLargeError?413:404});}
}
