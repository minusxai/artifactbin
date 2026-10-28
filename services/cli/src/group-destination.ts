import type {ArtifactDestination,DefaultDestination,GroupDetail} from '@artifactbin/contracts';
import {CliError} from './errors';
import {HttpClient} from './http';
import {setClientDefault} from './config';

/** Handles locate a group; only a resolved immutable ID is sent as authority. */
export async function groupDestination(client:HttpClient,handle:string,publishing=false):Promise<ArtifactDestination>{
 const detail=await client.request<GroupDetail>(`/groups/${encodeURIComponent(handle)}`);
 const group=detail.group;
 if(!group||typeof group.id!=='string'||!group.id)throw new CliError('invalid_response','The group response has no group identity.');
 if(group.role!=='editor'&&group.role!=='viewer')throw new CliError('group_membership_required','Join this group before selecting it.');
 if(publishing&&group.role!=='editor')throw new CliError('group_editor_required','Publishing to this group requires editor membership.');
 return {type:'group',id:group.id};
}
/** Preference mutation precedes the local host write; failures report which side committed. */
export async function setupDestination(client:HttpClient,options:{group?:string;personal?:boolean;inherit?:boolean;setDefault:boolean;home:string;env?:NodeJS.ProcessEnv}){
 const destination:DefaultDestination|undefined=options.group?await groupDestination(client,options.group):options.personal?{type:'personal'}:options.inherit?{type:'inherit'}:undefined;
 // A supplied group read authenticates membership. An explicit host-only default still verifies
 // the recipient's actual saved grant, with HttpClient's normal refresh and authentication retry.
 if(!destination)await client.request('/me/preferences');
 if(!options.setDefault)return {server:client.connection.server,destination,default_set:false};
 if(destination)await client.request('/me/preferences','PUT',{default_destination:destination});
 try{await setClientDefault('host',client.connection.server,options.home,options.env);}
 catch(error){throw new CliError('setup_partial_failure',destination?'The account destination was saved, but the local default server could not be saved.':'Authentication succeeded, but the local default server could not be saved.','Retry this same setup command.',{server:client.connection.server,preference_saved:!!destination,local_default_saved:false,cause:error instanceof Error?error.message:String(error)});}
 return {server:client.connection.server,destination,default_set:true};
}
