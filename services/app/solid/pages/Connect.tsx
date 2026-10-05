/* @jsxImportSource solid-js */
import {onCleanup,onMount} from 'solid-js';
import {FileConnectReceiver,connectRequest} from '../components/FileConnectReceiver';
import {useChromeVisibility} from '../components/PageChrome';
import {LoginPage} from './Login';
import {useSession} from '../lib/session';
export function ConnectPage(){
 const chrome=useChromeVisibility(),session=useSession();
 onMount(()=>chrome?.(false));onCleanup(()=>chrome?.(true));
 return <FileConnectReceiver adapter={{hosted:true,inspect:offer=>connectRequest('/connect/inspect',offer),apply:(offer,input)=>connectRequest('/connect/import',{...offer,...input})}}
  authentication={done=><LoginPage onAuthenticated={()=>{session.reload();done();}}/>}/>;
}
