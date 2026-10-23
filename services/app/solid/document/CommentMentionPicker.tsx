/* @jsxImportSource solid-js */
/** People a comment draft can mention; keyboard focus remains in the composer. */
import { createEffect, createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ArtifactBackend, MemberPerson } from '@/lib/artifact-backend/types';
import { personMention } from '@/lib/document/person-mentions';
import { ComboboxList, createListNavigation } from '../ui/Combobox';
import { Panel } from '../ui/Panel';
export interface MentionKeyboard { keyDown: (key: string) => boolean }
export function CommentMentionPicker(props: {
 backend: ArtifactBackend; artifactId?: string; query: string; onSelect: (text: string) => void;
 onReady?: (keyboard: MentionKeyboard | null) => void;
}): JSX.Element {
 const id=createUniqueId();
 const [people,setPeople]=createSignal<MemberPerson[]>([]);
 const unavailable=props.backend.unavailable('mentions');
 const choose=(person:MemberPerson)=>props.onSelect(personMention(person));
 const nav=createListNavigation({count:()=>people().length,onSelect:index=>{const person=people()[index];if(person)choose(person);}});
 onMount(()=>{props.onReady?.({keyDown:nav.keyDown});onCleanup(()=>props.onReady?.(null));});
 createEffect(()=>{
  const query=props.query;nav.setActive(0);
  if(!props.artifactId||unavailable)return;
  const abort=new AbortController();
  void props.backend.members(query,{signal:abort.signal}).then(answer=>{if(!abort.signal.aborted)setPeople(answer?.people??[]);}).catch(()=>{});
  onCleanup(()=>abort.abort());
 });
 return <Panel label="Mention people" padding="none" class="mb-2 overflow-hidden p-1.5 font-sans text-sm shadow-lg">
  <p class="px-2 py-1.5 text-xs font-medium text-muted">Mention a person</p>
  <Show when={people().length}>
   <ComboboxList id={`${id}-people`} label="People" options={people()} optionKey={person=>person.user_id}
    active={nav.active()} onActive={nav.setActive} onSelect={choose}
    renderOption={person=><span aria-label={`Mention @${person.username}`} class="flex w-full min-w-0 items-baseline gap-2 text-left"><span class="text-sm text-fg">@{person.username}</span><span class="truncate text-xs text-muted">{person.name}</span></span>}/>
  </Show>
  <Show when={unavailable} fallback={<Show when={!people().length}><p class="px-2 py-1 text-xs text-muted">No matching followers or members.</p></Show>}>
   <p role="note" class="px-2 py-1 text-xs text-muted">{unavailable}</p>
  </Show>
 </Panel>;
}
