import type {TestUser,ViewerChoice} from '@artifactbin/contracts';
import {CliError} from './errors';
import type {HttpClient} from './http';

/**
 * TEST USERS: the other person, minted and erased from here.
 *
 * A test user is a throwaway person this account owns. It is a full user toward artifacts test
 * users own and toward other test users, and exactly a guest toward everything else. Deleting one
 * ERASES everything it made, which is what makes it safe to mint — so the counts are read BEFORE
 * the erase: afterwards there is nothing left to report, and an agent has to be told what it just
 * destroyed.
 *
 * Bearer only. A test user never has CLI credentials of its own: the account acts, and names the
 * test user with `--as`.
 */
const TESTUSER_ID=/^[A-Za-z0-9_-]{1,128}$/;

/** The `--as` value on the wire: `guest`, or the test user an account minted. */
export function viewerChoice(value:string):ViewerChoice{return value==='guest'?'guest':{testuser:value};}

export function testUserIdentity(value:string):string{
 if(!TESTUSER_ID.test(value))throw new CliError('invalid_testuser',`${value} is not a test user id.`,'Run afbin testuser list for the ids this account holds, or afbin testuser new to mint one.');
 return value;
}

function parseTestUser(input:unknown):TestUser{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CliError('invalid_response','The server did not return a test user.');
 const value=input as Record<string,unknown>;
 if(typeof value.id!=='string'||typeof value.label!=='string'||typeof value.expires_at!=='string')throw new CliError('invalid_response','The server did not return a complete test user.');
 return {id:value.id,label:value.label,created_at:typeof value.created_at==='string'?value.created_at:'',
  expires_at:value.expires_at,artifacts:Number(value.artifacts??0),sessions:Number(value.sessions??0)};
}

export async function listTestUsers(client:HttpClient):Promise<TestUser[]>{
 const response=await client.request<{testusers?:unknown}>('/testusers');
 if(!Array.isArray(response.testusers))throw new CliError('invalid_response','The server did not return a test user collection.');
 return response.testusers.map(parseTestUser);
}

export async function testUserCommand(client:HttpClient,op:string,target:string|undefined,options:{all?:boolean}):Promise<Record<string,unknown>>{
 if(op==='new')return {...parseTestUser(await client.request('/testusers','POST',{}))};
 if(op==='list')return {testusers:await listTestUsers(client)};
 const held=await listTestUsers(client);
 // A named id that this account does not hold is still sent: the server's own refusal
 // (not_your_testuser) is the answer, never one the CLI invents from a stale list.
 const ids=options.all?held.map(entry=>entry.id):[testUserIdentity(target!)];
 const operations:Record<string,unknown>[]=[];
 let artifacts=0,sessions=0;
 for(const id of ids){
  const known=held.find(entry=>entry.id===id);
  await client.request(`/testusers/${id}`,'DELETE');
  if(known){artifacts+=known.artifacts;sessions+=known.sessions;}
  operations.push({id,...(known?{label:known.label,artifacts:known.artifacts,sessions:known.sessions}:{}),status:'deleted'});
 }
 return {operations,erased:{artifacts,sessions}};
}
