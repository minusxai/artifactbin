/** @jsxImportSource solid-js */
/**
 * lib/editor-v2/flow-editor in SOLID: the same framework-free ProseMirror view (lib/editor-v2/flow-view),
 * mounted once and synced whenever the incoming source, the path or a settled composition changes.
 * No `latest` ref: Solid props are live getters, so the view's callbacks read the current ones.
 */
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { serializeJsx } from '@/lib/jsx';
import { mountFlowView, type FlowEditorProps, type FlowView } from '@/lib/editor-v2/flow-view';

export function FlowEditor(props: FlowEditorProps) {
  let mount!: HTMLDivElement;
  let flow: FlowView | null = null;
  const [compositionEpoch, setCompositionEpoch] = createSignal(0);
  onMount(() => {
    flow = mountFlowView(mount, () => props, () => setCompositionEpoch((n) => n + 1));
    onCleanup(() => { flow?.destroy(); flow = null; });
  });
  // React's dependency list [incoming, nodes, path, compositionEpoch], as explicit sources.
  createEffect(on([() => serializeJsx(props.nodes), () => props.nodes, () => props.path, compositionEpoch], () => flow?.sync(props.nodes), { defer: true }));
  return <div ref={mount} class="mx-prose-region" style={{ display: 'contents' }} />;
}
