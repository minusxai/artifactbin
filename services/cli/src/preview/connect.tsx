/** The npm preview supplies local capabilities to the shared inert file receiver. */
import {render} from 'solid-js/web';
import {FileConnectReceiver,connectRequest} from '../../../app/solid/components/FileConnectReceiver';
import {PREVIEW_CONNECT_INSPECT_PATH,PREVIEW_CONNECT_IMPORT_PATH} from '../../../contracts/src/preview-connect';
const mount=document.getElementById('afbin-connect');
if(mount){mount.replaceChildren();render(()=> <FileConnectReceiver adapter={{
 inspect:offer=>connectRequest(PREVIEW_CONNECT_INSPECT_PATH,offer),
 apply:(offer,input)=>connectRequest(PREVIEW_CONNECT_IMPORT_PATH,{...offer,target:input.target}),
}}/>,mount);}
