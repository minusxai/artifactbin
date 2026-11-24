import {createSignal, For, Show} from 'solid-js';
import {siteAliasLimit,validSiteAlias} from '@artifactbin/contracts/site-alias';
import {usePageData} from '../lib/use-page-data';
import {MoveToFolderDialog} from '../components/MoveToFolderDialog';
import {Button} from '../ui/Button';
import {Field, Input} from '../ui/Field';
import {Panel} from '../ui/Panel';
import {SectionHeading} from '../ui/PageHeader';

interface Root {subdomain_label:string; folder_id:string|null}
interface Folder {id:string; title:string|null; ancestor_ids:string[]}
export function WebsiteSettings(props:{url:string}) {
  const settings=usePageData<{roots:Root[];folders:Folder[]}>('/api/my/website');
  const [label,setLabel]=createSignal('');
  const [editing,setEditing]=createSignal<(Root & {expected?:string|null})|'new'|null>(null);
  const [error,setError]=createSignal('');
  const folders=()=>settings.data()?.folders ?? [];
  const ownerHost=()=>new URL(props.url).hostname;
  const url=(label:string)=>{
    const site=new URL(props.url);
    if(label)site.hostname=site.hostname.replace('.', '--'+label+'.');
    return site.origin;
  };
  const taken=(slug:string)=>settings.data()?.roots.some(r=>r.subdomain_label===slug);
  const limit=()=>siteAliasLimit(ownerHost());
  function suggest(id:string|null) {
    if(editing()!=='new')return;
    const title=id===null?'Workspace':folders().find(f=>f.id===id)?.title;
    const stem=title?.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'folder';
    for(let n=1;;n++){
      const suffix=n===1?'':'-'+n;
      if(limit()<=suffix.length){setLabel('');break;}
      const slug=stem.slice(0,limit()-suffix.length).replace(/-+$/,'')+suffix;
      if(!taken(slug)){setLabel(slug);break;}
    }
    setError('');
  }
  function labelError() {
    if(editing()!=='new')return '';
    if(!validSiteAlias(label(),ownerHost()))return `Use 1–${limit()} lowercase letters, numbers or single internal hyphens.`;
    return taken(label())?'This label is taken. Choose another label.':'';
  }
  async function change(method:'PUT'|'DELETE',root:Root,expected?:string|null) {
    setError('');
    try {
      const result=await fetch('/api/my/website',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...root,expected_folder_id:expected})});
      if(result.ok){await settings.refresh(true);setEditing(null);return true;}
      if(result.status===409){
        await settings.refresh(true);
        setError(method==='DELETE'?'This mapping changed. Review its current folder before removing it.':editing()==='new'?'This label is taken. Choose another label.':'This mapping changed. Close the picker and choose the folder again.');
        return false;
      }
    } catch { /* Network failures can be retried in the picker. */ }
    setError('Could not update this website. Try again.');return false;
  }
  return <section aria-labelledby="website-heading"><SectionHeading id="website-heading">Website</SectionHeading>
    <Panel class="mt-4 space-y-4">
      <Show when={settings.error()}><Button onClick={()=>void settings.refresh(true)}>Retry website settings</Button></Show>
      <Show when={settings.data()}>{data=><>
        <For each={[data().roots.find(r=>!r.subdomain_label) ?? {subdomain_label:'',folder_id:null},...data().roots.filter(r=>r.subdomain_label)]}>{root=>
          <div class="flex flex-wrap items-center gap-2"><div class="min-w-0 flex-1">
            <a class="break-all text-accent" href={url(root.subdomain_label)}>{url(root.subdomain_label)}</a>
            <p class="text-sm text-muted">{root.folder_id ? folders().find(f=>f.id===root.folder_id)?.title ?? 'Unavailable folder' : data().roots.includes(root) ? 'Workspace' : 'All public pages'}</p></div>
            <Button variant="secondary" onClick={()=>{setError('');setEditing({...root,expected:data().roots.includes(root)?root.folder_id:undefined});}}>Choose folder</Button>
            <Show when={root.subdomain_label}><Button variant="ghost" onClick={()=>void change('DELETE',root,root.folder_id)}>Remove</Button></Show>
          </div>}</For>
        <Button disabled={limit()<1} onClick={()=>{setEditing('new');suggest(null);}}>Add subdomain</Button>
      </>}</Show>
      <Show when={!editing() && error()}><p role="alert">{error()}</p></Show>
    </Panel>
    <Show when={editing()} keyed>{root=><MoveToFolderDialog website title={root==='new'?'Add subdomain':url(root.subdomain_label)} currentParentId={root==='new'?null:root.folder_id}
      folders={folders()} onClose={()=>{setEditing(null);setError('');}} onSelect={suggest} saveDisabled={!!labelError()} saveError={error()}
      onMove={folder_id=>change('PUT',{subdomain_label:root==='new'?label():root.subdomain_label,folder_id},
        root==='new' ? undefined : root.expected)}>
      <Show when={root==='new'}><Field label="Website label" error={labelError()} hint={!labelError() && <span class="break-all">{url(label())}</span>}><Input value={label()} onInput={e=>{setLabel(e.currentTarget.value);setError('');}} /></Field></Show>
    </MoveToFolderDialog>}</Show>
  </section>;
}
