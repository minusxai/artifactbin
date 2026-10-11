/** @jsxImportSource solid-js */
/**
 * The offline file's three modal questions, composed from solid/ui like the hosted app's: restore a crash
 * buffer, ask who is commenting, and connect the file to a server. State and transport stay with the caller
 * (solid-entry); these only draw the dialog and report the answer.
 */
import { Show } from 'solid-js';
import { Button } from '@/solid/ui/Button';
import { Dialog } from '@/solid/ui/Dialog';
import { Field, Input } from '@/solid/ui/Field';
import { StatusMessage } from '@/solid/ui/StatusMessage';
import { LINK } from '@/solid/ui/ui';

/**
 * "Restore unsaved changes?" A recovery that must be answered: neither Escape nor a backdrop press discards the
 * draft, only Discard does.
 */
export function RestoreDialog(props: { savedAt: string | number; onAnswer: (restore: boolean) => void }) {
  return <Dialog role="alertdialog" title="Restore unsaved changes" dismissible={false} onClose={() => {}} initialFocus="[data-restore]"
    description={<>Restore unsaved changes from {new Date(props.savedAt).toLocaleString()}?</>}
    footer={<>
      <Button variant="secondary" onClick={() => props.onAnswer(false)}>Discard</Button>
      <Button data-restore onClick={() => props.onAnswer(true)}>Restore</Button>
    </>} />;
}

/** "What should we call you?" The answer is the typed name; `null` is Cancel (or Escape). */
export function NameDialog(props: { onAnswer: (name: string | null) => void }) {
  let input: HTMLInputElement | undefined;
  return <Dialog title="What should we call you?" size="sm" onClose={() => props.onAnswer(null)}
    footer={<>
      <Button variant="secondary" onClick={() => props.onAnswer(null)}>Cancel</Button>
      <Button onClick={() => props.onAnswer(input?.value ?? '')}>Save</Button>
    </>}>
    <Field label="Your name"><Input ref={input} /></Field>
  </Dialog>;
}

/** Send a copy of this file to a local preview server or to hosted artifactbin. Escape and Close both cancel a connection in flight. */
export function ConnectDialog(props: {
  address: string;
  onAddress: (address: string) => void;
  connecting: boolean;
  status: string;
  error: string;
  openedUrl: string;
  onConnect: () => void;
  onClose: () => void;
}) {
  return <Dialog title="Connect to server" size="lg" align="top" onClose={props.onClose}
    footer={<>
      <Button variant="secondary" onClick={props.onClose}>{props.connecting ? 'Cancel connection' : 'Close'}</Button>
      <Button disabled={props.connecting} onClick={props.onConnect}>{props.connecting ? 'Connecting…' : 'Connect'}</Button>
    </>}>
    <div class="space-y-4 text-sm">
      <p>Connect to a local preview server for a workspace copy, or to hosted artifactbin to update the original. Connecting only sends a copy for review. Nothing is published until you confirm “Apply to original” or “Create independent copy” in the server tab. Your original HTML file stays here.</p>
      <p><a class={LINK} href="https://app.artifactbin.dev/getting-started.md" target="_blank" rel="noopener">Install Node and afbin if needed</a>. If <code>afbin</code> is not installed, run <code>npx --yes @afbin/cli@latest setup</code> once (Windows PowerShell: <code>npx.cmd --yes @afbin/cli@latest setup</code>); it installs the <code>afbin</code> command and the agent skills. Then start a local server:</p>
      <p class="break-words text-xs">macOS / Linux: <code>afbin preview --port 7474</code></p>
      <p class="break-words text-xs">Windows PowerShell: <code>afbin.cmd preview --port 7474</code></p>
      <Field label="Server address" hint="Use http://localhost:7474, or the HTTPS address of hosted artifactbin or your compatible server.">
        <Input value={props.address} onInput={(event) => props.onAddress(event.currentTarget.value)} disabled={props.connecting} />
      </Field>
      <Show when={props.status}><StatusMessage kind="notice">{props.status}</StatusMessage></Show>
      <Show when={props.error}><StatusMessage kind="error">{props.error}</StatusMessage></Show>
      <Show when={props.openedUrl}><a class={LINK} href={props.openedUrl} target="_blank" rel="noopener">Open server editor</a></Show>
    </div>
  </Dialog>;
}
