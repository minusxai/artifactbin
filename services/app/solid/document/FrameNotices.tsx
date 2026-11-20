/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { CspRequest } from '@/lib/document';
import { TrustedUi } from '../components/TrustedUi';
import { ReaderNotice } from './ReaderNotice';

/** The notices above the frame, in its slot: the document's blocked network request, and (until a newer version is
 * shown: publish refuses a script that does not build, so any newer head built its own) a page script that failed. */
export default function FrameNotices(props: { slot: HTMLElement | null; id: string; csp?: CspRequest; accountSession: boolean; scriptErrors?: string[] }): JSX.Element {
  return <>
    <Show when={props.csp?.status === 'blocked' && props.slot}>{(slot) => (
      <Portal mount={slot()}><TrustedUi><ReaderNotice label="Document network access" load={() => import('./CspConsentBar')}>{module => <module.CspConsentBar id={props.id} request={props.csp!} accountSession={props.accountSession} />}</ReaderNotice></TrustedUi></Portal>
    )}</Show>
    <Show when={!!props.scriptErrors?.length && props.slot}>{(slot) => (
      <Portal mount={slot()}><TrustedUi><ReaderNotice label="Page script error" load={() => import('./ScriptFailureNotice')}>{module => <module.ScriptFailureNotice errors={props.scriptErrors!} />}</ReaderNotice></TrustedUi></Portal>
    )}</Show>
  </>;
}
