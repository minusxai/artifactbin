import type {Queryable} from '../../services/app/lib/platform/db';
/** Trusted local lifecycle capability; never accepted in a serialized page/import input. */
export interface NativeDisposableRuntimeActorPort {
 provision(tx:Queryable,userId:string):Promise<{userId:string;tokenId:string}>;
}
export interface NativeDisposableRuntimeActorReceipt {
 format:'native-disposable-runtime-actors-v1';identityPlanSha256:string;
 tokens:readonly {userId:string;tokenIdSha256:string;expiresAt:string;revoked:boolean}[];
}
