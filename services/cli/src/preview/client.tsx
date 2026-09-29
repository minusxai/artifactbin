import {createRoot} from 'react-dom/client';
import {PreviewWorkspace} from './workspace';
const capture=new URLSearchParams(location.search).get('capture')==='1';
const file=decodeURIComponent(location.pathname.slice('/workspace/'.length));
void fetch('/document?file='+encodeURIComponent(file)).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);return value;}).then(initial=>createRoot(document.getElementById('root')!).render(<PreviewWorkspace initial={initial} file={file} capture={capture}/>)).catch(error=>{document.getElementById('root')!.textContent=error.message;});
