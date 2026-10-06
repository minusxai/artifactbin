/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { Button } from './ui';

interface PathMapping { path: string; artifactId: string }
interface DocumentOption { id: string; title: string }
const REFUSALS: Record<string, string> = {
  invalid_path: 'Choose a path like /about or /guides/start, using letters, numbers, hyphens and underscores. The homepage and document runtime paths are reserved.',
  invalid_document: 'Choose one of your public documents. This document is no longer available.',
  path_limit: 'You can have up to 50 custom paths. Remove a path before adding another.',
  not_found: 'This domain is no longer attached. Reload your settings.',
};

/** A compact list and one editor. Server edits address one path, never replace the entire list. */
export function CustomDomainPaths(props: {
  hostname: string;
  paths: PathMapping[];
  documents: DocumentOption[];
  busy: boolean;
  save: (path: string, artifactId: string | null) => Promise<string | null>;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const [existing, setExisting] = createSignal(false);
  const [path, setPath] = createSignal('');
  const [artifactId, setArtifactId] = createSignal('');
  const [message, setMessage] = createSignal<{ error: boolean; text: string } | null>(null);
  const open = (mapping?: PathMapping) => {
    setPath(mapping?.path ?? ''); setArtifactId(mapping?.artifactId ?? '');
    setExisting(!!mapping); setEditing(true); setMessage(null);
  };
  const save = async (remove?: PathMapping) => {
    const value = remove?.path ?? path().trim();
    if (!remove && !existing() && props.paths.some(mapping => mapping.path === value)) {
      setMessage({ error: true, text: 'This path is already mapped. Use its Edit button to change the document.' }); return;
    }
    const error = await props.save(value, remove ? null : artifactId());
    if (error) { setMessage({ error: true, text: REFUSALS[error] ?? 'Could not save this path. Try again.' }); return; }
    setEditing(false); setMessage({ error: false, text: remove ? 'Custom path removed.' : 'Custom path saved.' });
  };
  const eligible = () => props.documents.some(document => document.id === artifactId());
  return <section aria-labelledby="domain-paths-heading" class="mt-5 border-t border-edge pt-4">
    <div class="flex flex-wrap items-center justify-between gap-2"><h3 id="domain-paths-heading" class="text-sm font-medium">Custom paths</h3><Button type="button" variant="ghost" aria-label="Add custom path" disabled={props.busy || editing() || props.paths.length >= 50} onClick={() => open()}>Add path</Button></div>
    <p class="mt-1 text-xs leading-relaxed text-muted">Give a public document a URL like /about or /guides/start. Existing document links keep working.</p>
    <Show when={props.paths.length > 0} fallback={<Show when={!editing()}><p class="mt-3 text-xs text-faint">No custom paths yet.</p></Show>}>
      <ul aria-label="Custom path mappings" class="mt-3 max-h-64 overflow-y-auto divide-y divide-edge">
        <For each={props.paths}>{mapping => <li class="flex flex-wrap items-center gap-3 py-3">
          <div class="min-w-0 flex-1"><a href={`https://${props.hostname}${mapping.path}`} target="_blank" rel="noopener noreferrer" class="break-all font-mono text-sm text-accent hover:underline">{mapping.path}</a><p class="mt-1 truncate text-xs text-muted">{props.documents.find(document => document.id === mapping.artifactId)?.title || 'Document unavailable — this URL returns not found'}</p></div>
          <div class="flex shrink-0 gap-2"><Button type="button" variant="ghost" aria-label={`Edit path ${mapping.path}`} disabled={props.busy} onClick={() => open(mapping)}>Edit</Button><Button type="button" variant="danger" aria-label={`Remove path ${mapping.path}`} disabled={props.busy} onClick={() => void save(mapping)}>Remove</Button></div>
        </li>}</For>
      </ul>
    </Show>
    <Show when={editing()}><form aria-label="Custom path editor" class="mt-3 rounded-[4px] border border-edge bg-raised p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div class="grid gap-3 sm:grid-cols-2"><label class="min-w-0 text-xs font-medium">Path<input aria-label="Custom path" placeholder="/about" maxlength={200} readOnly={existing()} disabled={props.busy} value={path()} onInput={event => setPath(event.currentTarget.value)} autocomplete="off" spellcheck={false} class="mt-1 block w-full min-w-0 rounded-[4px] border border-edge-bright bg-surface px-3 py-2 font-mono text-sm" /></label>
      <label class="min-w-0 text-xs font-medium">Document<select aria-label="Path document" disabled={props.busy} value={artifactId()} onChange={event => setArtifactId(event.currentTarget.value)} class="mt-1 block w-full min-w-0 rounded-[4px] border border-edge-bright bg-surface px-3 py-2 text-sm">
        <option value="" selected={!artifactId()}>Choose a public document</option>
        <Show when={artifactId() && !eligible()}><option value={artifactId()} selected>Document unavailable</option></Show>
        <For each={props.documents}>{document => <option value={document.id} selected={artifactId() === document.id}>{document.title || 'Untitled document'}</option>}</For>
      </select></label></div>
      <p class="mt-2 break-all text-xs text-muted">{props.hostname}{path() || '/about'}</p>
      <div class="mt-3 flex gap-2"><Button type="submit" aria-label="Save custom path" disabled={props.busy || !path().trim() || !eligible()}>Save path</Button><Button type="button" variant="ghost" disabled={props.busy} onClick={() => { setEditing(false); setMessage(null); }}>Cancel</Button></div>
    </form></Show>
    <Show when={message()}>{value => <p role={value().error ? 'alert' : 'status'} class={`mt-3 text-xs leading-relaxed ${value().error ? 'text-danger' : 'text-accent'}`}>{value().text}</p>}</Show>
  </section>;
}
