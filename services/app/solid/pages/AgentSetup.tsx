/* @jsxImportSource solid-js */
/** Shared onboarding at the product-owned /start entry, including when a deployment supplies its own shell. */
import {createSignal, onMount, Show, type JSX} from 'solid-js';
import type {ArtifactDestination} from '@artifactbin/contracts';
import {loginHref} from '@/lib/http/login-href';
import GetStarted from '../components/GetStarted';
import {replaceDocument} from '../lib/document-navigation';
import {GettingStartedPage} from './GettingStarted';

interface SetupGroup {id:string;handle:string;name:string;}
export function AgentSetupPage(): JSX.Element {
 const params=new URLSearchParams(window.location.search), groupId=params.get('group');
 const setupHref=`/start?setup=1${groupId?`&group=${encodeURIComponent(groupId)}`:''}`;
 const [group,setGroup]=createSignal<SetupGroup>();
 const [ready,setReady]=createSignal(!groupId), [error,setError]=createSignal('');
 onMount(()=>{if(!groupId)return;void fetch(`/api/groups/${encodeURIComponent(groupId)}`).then(async response=>{
  if(response.status===401){replaceDocument(loginHref(window.location));return;}
  if(!response.ok)throw new Error('This group is unavailable. Return to your workspace and choose a group you can access.');
  const body=await response.json() as {group?:SetupGroup};
  if(!body.group?.id||!body.group.handle||!body.group.name)throw new Error('Could not load the selected group.');
  setGroup(body.group);setReady(true);
 }).catch(e=>setError(e instanceof Error?e.message:'Could not load the selected group.'));});
 const destination=():ArtifactDestination|undefined=>group()?{type:'group',id:group()!.id}:undefined;
 return <Show when={!error()} fallback={<main class="workspace-page"><p role="alert">{error()}</p><a href="/">Back to workspace</a></main>}>
  <Show when={ready()} fallback={<p role="status">Loading your group…</p>}>
   <Show when={params.get('guide')!=='1'} fallback={<GettingStartedPage backHref={setupHref}/> }>
    <main class="mx-auto w-full max-w-2xl space-y-6 px-6 py-12">
     <a href="/" class="text-sm text-accent">Back to workspace</a>
     <h1 class="text-2xl font-semibold">Create with your agent</h1>
     <Show when={group()}><p class="text-sm text-muted">Creating in {group()!.name}.</p></Show>
     <GetStarted heading={false} destination={destination()} group={group()} guideHref={`${setupHref}&guide=1`}/>
    </main>
   </Show>
  </Show>
 </Show>;
}
