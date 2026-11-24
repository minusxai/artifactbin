import {createSignal, For, Show} from 'solid-js';
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
  const [editing,setEditing]=createSignal<Root|null>(null);
  const [error,setError]=createSignal('');
  const folders=()=>settings.data()?.folders ?? [];
  const url=(label:string)=>{const site=new URL(props.url);if(label)site.hostname=label+'.'+site.hostname;return site.origin;};
  async function change(method:'PUT'|'DELETE',root:Root) {
    setError('');
    try {
      const result=await fetch('/api/my/website',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(root)});
      if(result.ok){await settings.refresh(true);setEditing(null);setLabel('');return true;}
    } catch { /* Show the same retry feedback for network failures. */ }
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
            <Button variant="secondary" onClick={()=>setEditing(root)}>Choose folder</Button>
            <Show when={root.subdomain_label}><Button variant="ghost" onClick={()=>void change('DELETE',root)}>Remove</Button></Show>
          </div>}</For>
        <Field label="New subdomain"><Input value={label()} onInput={e=>setLabel(e.currentTarget.value)} /></Field>
        <Button disabled={!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label()) || data().roots.some(r=>r.subdomain_label===label())} onClick={()=>setEditing({subdomain_label:label(),folder_id:null})}>Add subdomain</Button>
      </>}</Show>
      <Show when={error()}><p role="alert">{error()}</p></Show>
    </Panel>
    <Show when={editing()} keyed>{root=><MoveToFolderDialog website title={url(root.subdomain_label)} currentParentId={root.folder_id} folders={folders()} onClose={()=>setEditing(null)} onMove={folder_id=>change('PUT',{...root,folder_id})}/>}</Show>
  </section>;
}
