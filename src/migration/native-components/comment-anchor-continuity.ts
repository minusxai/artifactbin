import type {LegacyRow} from '../contracts.ts';

/** Captured allocation history proves that a source DOM identity was never retired. */
export interface NativeCommentAnchorContinuityInput {
 sourceId:string;
 headVersion:number;
 anchorVersion:unknown;
 anchorKey:unknown;
 allocations:readonly LegacyRow[];
}

/** Current DOM resolution and native reader eligibility are checked separately. */
export function nativeCommentAnchorHasContinuity(input:NativeCommentAnchorContinuityInput):boolean {
 if(typeof input.anchorKey!=='string'||!Number.isSafeInteger(input.headVersion)||input.headVersion<1)return false;
 if(input.anchorVersion===input.headVersion)return true;
 if(!Number.isSafeInteger(input.anchorVersion)||Number(input.anchorVersion)<1||Number(input.anchorVersion)>=input.headVersion)return false;
 const records=input.allocations.filter(row=>row.artifact_id===input.sourceId&&row.source_id===input.anchorKey);
 if(records.length!==1)return false;
 const record=records[0]!;
 return Number.isSafeInteger(record.first_version)&&Number(record.first_version)>=1&&Number(record.first_version)<=Number(input.anchorVersion)&&record.retired_version===null;
}
