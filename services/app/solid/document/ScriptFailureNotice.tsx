/* @jsxImportSource solid-js */
/**
 * WHY THIS PAGE RUNS WITHOUT ITS SCRIPT, for someone who can fix it. A version stored under an earlier API (its
 * Helmet script imports a `page` export that no longer exists) is served without the script, and every copy of the
 * page tells its readers so (lib/compiled-page/assembler). This page's writers also get the builder's own messages
 * (lib/document-serving/artifact-page `scriptFailure`, recorded with the version by lib/publish/prepared/prepared-page.server)
 * and what resolves it. It renders in the slot above the frame, as the consent bar does (solid/pages/Document).
 */
import { For, type JSX } from 'solid-js';
import { StatusMessage } from '../ui/StatusMessage';

export function ScriptFailureNotice(props: { errors: readonly string[] }): JSX.Element {
  return <section aria-label="Page script error" class="border-b border-edge bg-surface px-3 py-2">
    <StatusMessage kind="caution">
      <span class="block">This page's script does not build, so readers see the page without it. Republish it with a fixed script to resolve this.</span>
      <For each={props.errors}>{(error) => <code class="mt-1 block whitespace-pre-wrap break-words font-mono text-xs">{error}</code>}</For>
    </StatusMessage>
  </section>;
}
