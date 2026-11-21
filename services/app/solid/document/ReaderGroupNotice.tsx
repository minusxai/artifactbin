/* @jsxImportSource solid-js */
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { TrustedUi } from '../components/TrustedUi';
import { Button } from '../ui/Button';

import type {ReaderScope} from '@/lib/html-reader/frame-bridge/parent';

/** The trusted page shell offers only groups returned for the refused query. */
export default function ReaderGroupNotice(props: {scope: ReaderScope; slot: HTMLElement | null; switchGroup(id: string): void}) {
  return <Show when={props.slot}>{slot =>
    <Portal mount={slot()}><TrustedUi><section aria-label="Data access" class="flex items-center gap-2 border-b border-edge bg-surface px-3 py-2 text-sm">
      <span>Viewing as {props.scope.name}</span>
      <Show when={props.scope.choices.length}><span>Access denied as {props.scope.name}.</span></Show>
      <For each={props.scope.choices}>{group =>
        <Button size="sm" onClick={() => props.switchGroup(group.id)}>Switch to {group.name}</Button>}
      </For>
    </section></TrustedUi></Portal>}</Show>;
}
