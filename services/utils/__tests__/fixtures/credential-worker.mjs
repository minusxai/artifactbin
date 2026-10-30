/** Synthetic-home process harness: real storage, locks and author auth commands. */
import {readCredentials,refreshCredentials,saveCredentials} from '../../src/credentials.ts';
import {withStateLock} from '../../src/state-lock.ts';
import {authCommand} from '../../../app/skills/artifactbin/scripts/auth.mjs';
import {makeClient} from '../../../app/skills/artifactbin/scripts/toolbox-client.mjs';
const [root,action]=process.argv.slice(2),server='https://example.test';
const send=value=>process.send(value);
const wait=()=>new Promise(resolve=>process.once('message',resolve));
const env={ARTIFACTBIN_URL:server,...(action==='request-default'?{}:{ARTIFACTBIN_HOME:root})};
const fetcher=async(url,init)=>{
 if(String(url).endsWith('/oauth/token')){send({event:'rotation'});await wait();return Response.json({access_token:'new_access',refresh_token:'new_refresh',expires_in:3600});}
 return Response.json({authorization:new Headers(init.headers).get('Authorization')});
};
try{
 let result;
 if(action==='refresh'){
  const stale=await readCredentials(server,root);send({event:'ready'});await wait();
  result=await refreshCredentials(stale,root,{fetch:fetcher});
 }else if(action==='hold'){
  await withStateLock(root,'home',async()=>{send({event:'locked'});await wait();});
 }else if(action==='logout'||action==='queued-logout'){
  if(action==='queued-logout'){send({event:'ready'});await wait();send({event:'attempting'});}
  result=await authCommand({sub:'logout',values:{local:true},positionals:[]},{env,fetcher});
 }else if(action==='request'||action==='request-default'||action==='environment')result=await makeClient(server,{env:{...env,...(action==='environment'?{ARTIFACTBIN_TOKEN:'ephemeral_access'}:{})},fetcher}).request('/api/example');
 else if(action==='read')result=await readCredentials(server,root);
 else if(action==='save')result=await saveCredentials({server,token:'replacement_access',refreshToken:'replacement_refresh',clientId:'replacement_client'},root);
 else throw new Error('Unknown harness action');
 send({event:'result',result});
}catch(error){send({event:'error',message:error.message,code:error.code});}
process.disconnect();
