/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Panel, ListRow } from '../ui/Panel';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';

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
    <div class="flex flex-wrap items-center justify-between gap-2"><h3 id="domain-paths-heading" class="text-sm font-medium">Custom paths</h3><Button type="button" variant="secondary" aria-label="Add custom path" disabled={props.busy || editing() || props.paths.length >= 50} onClick={() => open()}>Add path</Button></div>
    <p class="mt-1 text-xs leading-relaxed text-muted">Give a public document a URL like /about or /guides/start. Existing document links keep working.</p>
    <Show when={props.paths.length > 0} fallback={<Show when={!editing()}><p class="mt-3 text-xs text-faint">No custom paths yet.</p></Show>}>
      <ul aria-label="Custom path mappings" class="mt-3 max-h-64 overflow-y-auto">
        <For each={props.paths}>{mapping => <ListRow>
          <div class="min-w-0 flex-1"><a href={`https://${props.hostname}${mapping.path}`} target="_blank" rel="noopener noreferrer" class="break-all font-mono text-sm text-accent hover:underline">{mapping.path}</a><p class="mt-1 truncate text-xs text-muted">{props.documents.find(document => document.id === mapping.artifactId)?.title || 'Document unavailable — this URL returns not found'}</p></div>
          <div class="flex shrink-0 gap-2"><Button type="button" variant="secondary" aria-label={`Edit path ${mapping.path}`} disabled={props.busy} onClick={() => open(mapping)}>Edit</Button><Button type="button" variant="danger" aria-label={`Remove path ${mapping.path}`} disabled={props.busy} onClick={() => void save(mapping)}>Remove</Button></div>
        </ListRow>}</For>
      </ul>
    </Show>
    <Show when={editing()}><form aria-label="Custom path editor" class="mt-4" onSubmit={event => { event.preventDefault(); void save(); }}><Panel padding="sm">
      <div class="grid gap-3 sm:grid-cols-2"><Field label="Path"><Input aria-label="Custom path" placeholder="/about" maxlength={200} readOnly={existing()} disabled={props.busy} value={path()} onInput={event => setPath(event.currentTarget.value)} autocomplete="off" spellcheck={false} class="font-mono" /></Field>
      <Field label="Document"><Select ariaLabel="Path document" disabled={props.busy} value={artifactId()} onChange={setArtifactId} options={[
        { value: '', label: 'Choose a public document' },
        ...(artifactId() && !eligible() ? [{ value: artifactId(), label: 'Document unavailable' }] : []),
        ...props.documents.map(document => ({ value: document.id, label: document.title || 'Untitled document' })),
      ]} /></Field></div>
      <p class="mt-2 break-all text-xs text-muted">{props.hostname}{path() || '/about'}</p>
      <div class="mt-3 flex gap-2"><Button type="submit" aria-label="Save custom path" disabled={props.busy || !path().trim() || !eligible()}>Save path</Button><Button type="button" variant="secondary" disabled={props.busy} onClick={() => { setEditing(false); setMessage(null); }}>Cancel</Button></div>
    </Panel></form></Show>
    <Show when={message()}>{value => <StatusMessage kind={value().error ? 'error' : 'notice'} class="mt-3">{value().text}</StatusMessage>}</Show>
  </section>;
}
