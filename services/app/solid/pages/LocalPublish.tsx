/* @jsxImportSource solid-js */
/** Platform-owned publication: file access comes only from these explicit user selections. */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { loginHref } from '@/lib/http/login-href';
import { recoverPortableSource } from '@/lib/html-runtime/portable-source';
import { inspectLocalPublication, localPublicationRequest, publicationBody, readSelectedLocalFiles, receiveLocalPublication, sendLocalPublication, type LocalPublicationBody, type LocalPublicationPlan, type LocalPublicationReceipt, type LocalPublicationRequest, type LocalSelectedFile } from '@/lib/local-publication';
import { useSession } from '../lib/session';
import WorkspaceHeading from '../components/WorkspaceHeading';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';

interface Source { path: string; bytes: Uint8Array; html: string }
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
export function LocalPublishPage(): JSX.Element {
  const { session, sessionError } = useSession();
  const [source, setSource] = createSignal<Source | null>(null);
  const [files, setFiles] = createSignal<LocalSelectedFile[]>([]);
  const [title, setTitle] = createSignal('');
  const [plan, setPlan] = createSignal<LocalPublicationPlan | null>(null);
  const [snapshot, setSnapshot] = createSignal<LocalPublicationBody | null>(null);
  const [pending, setPending] = createSignal<LocalPublicationRequest | null>(null);
  const [receipt, setReceipt] = createSignal<LocalPublicationReceipt | null>(null);
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal('');
  const [returned, setReturned] = createSignal(false);
  let sourcePicker!: HTMLInputElement, dependencyPicker!: HTMLInputElement, folderPicker!: HTMLInputElement;
  let handoff: ReturnType<typeof receiveLocalPublication> | undefined;
  onMount(() => { handoff = receiveLocalPublication({ win: window }); });
  onCleanup(() => handoff?.dispose());
  const locked = () => busy() || pending() !== null;
  const invalidate = () => { setPlan(null); setSnapshot(null); setError(''); };
  const chooseSource = async (file: File | undefined) => {
    if (!file || locked()) return;
    setBusy(true); invalidate();
    try {
      const [picked] = await readSelectedLocalFiles([file]);
      if (!picked || !/\.html?$/i.test(picked.path)) throw new Error('Choose the HTML document you want to publish.');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(picked.bytes);
      setSource({ path: picked.path, bytes: picked.bytes, html: recoverPortableSource(raw) });
      setFiles([]); setTitle(file.name.replace(/\.html?$/i, ''));
    } catch (cause) { setSource(null); setError(cause instanceof Error ? cause.message : 'Could not read that HTML file.'); }
    finally { setBusy(false); }
  };
  const chooseDependencies = async (selected: File[]) => {
    if (!selected.length || locked()) return;
    setBusy(true); invalidate();
    try {
      const picked = await readSelectedLocalFiles(selected), current = source();
      const merged = new Map(files().map(file => [file.path, file]));
      for (const file of picked) {
        const previous = merged.get(file.path);
        if (previous && !sameBytes(previous.bytes, file.bytes)) throw new Error(`Two selected files use ${file.path}. Choose a single project folder with the intended files.`);
        merged.set(file.path, file);
      }
      if (current) {
        const matches = picked.filter(file => file.path.split('/').at(-1) === current.path.split('/').at(-1) && sameBytes(file.bytes, current.bytes));
        if (matches.length > 1) throw new Error('The selected folder contains more than one matching HTML source. Select a folder containing one copy of the chosen document.');
        if (matches[0]) setSource({ ...current, path: matches[0].path });
      }
      setFiles([...merged.values()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read the selected files.'); }
    finally { setBusy(false); }
  };
  const review = async () => {
    const selected = source(); if (!selected || locked()) return;
    setBusy(true); setError(''); setPlan(null);
    try {
      const body = publicationBody({ entryPath: selected.path, html: selected.html, files: files(), title: title() });
      const result = await inspectLocalPublication(body);
      setSnapshot(body); setPlan(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resolve the selected dependencies.'); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (busy() || receipt()) return;
    const body = snapshot(); if (!body || !plan()) return;
    const request = pending() ?? localPublicationRequest(body); setPending(request);
    setBusy(true); setError('');
    try {
      const saved = await sendLocalPublication(request, window.location.origin);
      setReceipt(saved); setReturned(handoff?.send(saved) === true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Publication could not finish. Retry to recover the same publication.'); }
    finally { setBusy(false); }
  };
  return <main class="workspace-page">
    <WorkspaceHeading title="Publish local HTML" description="Choose the current HTML file and its dependencies, review the files, then publish a private linked copy." />
    <Show when={session()} fallback={<StatusMessage kind={sessionError() ? 'error' : 'loading'}>{sessionError() ? 'Could not load your account. Reload this page to try again.' : 'Loading your account…'}</StatusMessage>}>
      <Show when={session()?.kind === 'account'} fallback={<Panel label="Sign in to publish"><p class="mb-4 text-sm text-muted">Sign in to choose files and publish them to your account.</p><Button href={loginHref(window.location)}>Sign in to publish</Button></Panel>}>
        <div class="space-y-5">
          <Show when={!receipt()} fallback={<Panel label="Publication complete"><StatusMessage kind="notice">Published. {returned() ? 'Return to your local document and choose Save linked HTML.' : 'Your local file is unchanged. Download the linked HTML from the published document when you are ready.'}</StatusMessage><Button class="mt-4" href={`/a/${receipt()!.identity.artifactId}`}>Open published document</Button></Panel>}>
            <Panel label="Choose local files" title="Choose files">
              <p class="mb-4 text-sm text-muted">Select the HTML source you have open locally. If it references sibling files, select those files or their project folder. Selected files are included in the publication bundle. Review every file before publishing.</p>
              <div class="flex flex-wrap gap-3">
                <Button type="button" variant="secondary" disabled={locked()} onClick={() => sourcePicker.click()}>Choose HTML file</Button>
                <Button type="button" variant="secondary" disabled={locked() || !source()} onClick={() => dependencyPicker.click()}>Choose dependency files</Button>
                <Button type="button" variant="secondary" disabled={locked() || !source()} onClick={() => folderPicker.click()}>Choose project folder</Button>
              </div>
              <input type="file" ref={sourcePicker} hidden accept=".html,.htm,text/html" aria-label="HTML source file" disabled={locked()} onChange={event => { void chooseSource(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
              <input type="file" ref={dependencyPicker} hidden multiple aria-label="Dependency files" disabled={locked()} onChange={event => { void chooseDependencies(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
              <input type="file" ref={folderPicker} hidden multiple {...{ webkitdirectory: '' }} aria-label="Project folder" disabled={locked()} onChange={event => { void chooseDependencies(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
              <Show when={source()}><p class="mt-4 break-words text-sm">Source: {source()!.path} · {files().length} selected dependency files</p><div class="mt-4"><Field label="Document title"><Input value={title()} disabled={locked()} onInput={event => { setTitle(event.currentTarget.value); invalidate(); }} /></Field></div><Button class="mt-4" type="button" variant="secondary" disabled={locked()} onClick={() => void review()}>Review publication</Button></Show>
            </Panel>
            <Show when={plan()}><Panel label="Publication summary" title="Review publication"><p class="mb-3 break-words text-sm">Destination: {window.location.origin}</p><p class="text-sm">{plan()!.entryPath} and {plan()!.dependencies.length} dependencies will be published privately to your account.</p><ul class="my-4 space-y-2 text-sm"><For each={plan()!.dependencies}>{file => <li class="break-words">{file.path} · {file.kind} · {file.bytes.toLocaleString()} bytes</li>}</For><For each={plan()!.backends ?? []}>{backend => <li class="break-words">{backend.path} · backend {backend.name} · {backend.bytes.toLocaleString()} bytes</li>}</For></ul><p class="mb-4 text-sm text-muted">Your disk files remain unchanged. Save linked HTML separately after publication.</p><Button type="button" disabled={busy()} onClick={() => void publish()}>{busy() ? 'Publishing…' : pending() ? 'Retry publication' : 'Publish privately'}</Button></Panel></Show>
          </Show>
          <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
          <Show when={busy() && !pending()}><StatusMessage kind="loading">Reading and checking the selected files…</StatusMessage></Show>
        </div>
      </Show>
    </Show>
  </main>;
}
