/**
 * A PAGE'S APPROVED QUERIES as operations (lib/query-approvals): an Admin of the group that owns a page lists its
 * queries on the install's default connection, approves one to run as the group for every reader, or revokes that.
 * A person only: a group's sign-in is refused by ./http and the library alike. Refusals keep the library's `message`.
 */
import {z} from 'zod';
import type {Operation,OpReply} from './registry';
import {QueryApprovalError,approvePageQuery,pageQueryApprovals,revokePageQuery} from '@/lib/query-approvals';

const errors=[
 {status:400,code:'validation_failed',fix:'Send query (the declared query\'s name) and hash (the hash list_query_approvals showed for it).'},
 {status:400,code:'not_group_owned',fix:'Move the page to a group first: a page owned by a person has no approved queries.'},
 {status:403,code:'forbidden',fix:'Ask an Admin of the group that owns the page (direct, or of a parent group).'},
 {status:403,code:'test_account_restricted',fix:'Approve with a real account, not a test account.'},
 {status:404,code:'not_found',fix:'Use a live page owned by a group you administer, and an approval id list_query_approvals shows.'},
 {status:404,code:'unknown_query',fix:'Use a query name list_query_approvals shows for the page\'s current version.'},
 {status:409,code:'query_changed',fix:'The query changed since you read it: list again, show the new text and statement, then approve its new hash.'},
];
async function answer(work:()=>Promise<OpReply>):Promise<OpReply>{
 try{return await work();}catch(error){if(error instanceof QueryApprovalError)return {status:error.status,body:error.body};throw error;}
}
const page=z.string().min(1);

export const QUERY_APPROVAL_OPERATIONS:Operation[]=[
 {name:'list_query_approvals',title:'List a page\'s approved queries',http:{method:'GET',path:'/api/artifacts/{id}/query-approvals'},
  description:'For an Admin of the group that owns a page: each query the page declares on a default: link, its connection, text, the parameters a reader may vary, its hash, a plain statement of what readers will see once it is approved, and its approval if one holds. Without an approval a query runs as each reader.',
  input:{id:page},annotations:{readOnly:true},example:{input:{id:'aB3xK9'}},errors,
  run:(ctx,input)=>answer(async()=>({status:200,body:{...await pageQueryApprovals(ctx.actor,String(input.id))}}))},
 {name:'approve_query',title:'Approve a page\'s query to run as its group',http:{method:'POST',path:'/api/artifacts/{id}/query-approvals'},
  description:'An Admin of the group that owns the page approves one declared query (by name, with the hash list_query_approvals showed): it then runs as that group at member level for every reader who can open the page, with only the allowed parameter values, until its text, connection or allowed parameters change, it is revoked, the page changes owner, the approver stops being Admin or the group is deleted. Tell the user its statement first. Answers the approval id.',
  input:{id:page,query:z.string().min(1),hash:z.string().min(1)},annotations:{},example:{input:{id:'aB3xK9',query:'totals',hash:'a'.repeat(64)}},errors,
  run:(ctx,input)=>answer(async()=>({status:201,body:{...await approvePageQuery(ctx.actor,String(input.id),{query:input.query,hash:input.hash})}}))},
 {name:'revoke_query_approval',title:'Revoke a page\'s query approval',http:{method:'DELETE',path:'/api/artifacts/{id}/query-approvals/{approvalId}'},
  description:'An Admin of the group that owns the page ends an approval at once: from the next read the query runs as each reader again. Answers {ok: true}; not_found when that approval was not live.',
  input:{id:page,approvalId:page},annotations:{destructive:true,idempotent:true},example:{input:{id:'aB3xK9',approvalId:'pqa_example'}},errors,
  run:(ctx,input)=>answer(async()=>await revokePageQuery(ctx.actor,String(input.id),String(input.approvalId))?{status:200,body:{ok:true}}:{status:404,body:{error:'not_found',message:'no live approval with that id on this page'}})},
];
