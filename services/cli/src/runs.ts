import {CliError} from './errors';
import type {HttpClient} from './http';

/** A published artifact is the executable; request identity belongs to the caller.
 * Never silently invent a new ID after an uncertain admission. */
export async function runCommand(client:HttpClient,action:string,id:string,options:{requestId?:string;input?:string;after?:string;limit?:string}={}):Promise<Record<string,unknown>>{
 if(action==='start'){
  let input:unknown=null;
  if(options.input!==undefined){try{input=JSON.parse(options.input);}catch{throw new CliError('invalid_input','Run input must be valid JSON.','Pass --input input.json (or --input - for stdin).');}}
  return client.request(`/artifacts/${id}/runs`,'POST',{requestId:options.requestId,input});
 }
 if(action==='status')return client.request(`/runs/${id}`);
 if(action==='cancel')return client.request(`/runs/${id}/cancel`,'POST');
 const query=new URLSearchParams({after:options.after??'0',limit:options.limit??'100'});
 return client.request(`/runs/${id}/events?${query}`);
}
