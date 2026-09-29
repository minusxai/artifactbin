/* @jsxImportSource solid-js */
/**
 * components/SourceEditorPane in SOLID: the JSX source editor with a read-only "View formatted"
 * preview. The editable editor stays mounted (hidden) while the preview shows, so its draft,
 * selection and undo history survive the round trip; the preview owns a separate read-only editor.
 *
 * Not ported: LazySourceEditor's plain-textarea fallback and its caret handoff (the Suspense fallback
 * here is a status line), and FeatureGate's tooltip (the reason is the button's description only).
 */
import { createEffect, createSignal, createUniqueId, lazy, onCleanup, Show, Suspense } from 'solid-js';
import type { SourceEditorProps } from './SourceEditor';
import { useSourceEditorTools } from './source-editor-tools';

export default function SourceEditorPane(props: SourceEditorProps) {
  const tools = useSourceEditorTools();
  const Editor = lazy(tools.editor);
  const reasonId = createUniqueId();
  const [formatted, setFormatted] = createSignal(false);
  const [preview, setPreview] = createSignal<{ source: string; text: string } | null>(null);
  const [error, setError] = createSignal(false);
  // The formatter became unavailable: back to the source.
  createEffect(() => { if (tools.formatterUnavailable) setFormatted(false); });
  createEffect(() => {
    if (!formatted()) return;
    const source = props.value;
    let cancelled = false;
    setError(false);
    void tools.formatter()
      .then(({ formatJsxPreview }) => formatJsxPreview(source))
      .then((text) => { if (!cancelled) setPreview({ source, text }); })
      .catch(() => { if (!cancelled) setError(true); });
    onCleanup(() => { cancelled = true; });
  });
  const unavailable = () => (formatted() ? null : tools.formatterUnavailable);

  return <div class="flex h-full flex-col" style={{ 'background-color': '#1e1e1e', color: '#d4d4d4' }}>
    <div class="flex shrink-0 items-center justify-between gap-3 px-3 py-2 text-xs" style={{ 'border-bottom': '1px solid #333' }}>
      <span>{formatted() ? 'Formatted preview · read-only' : 'JSX source'}</span>
      <button type="button" aria-label={formatted() ? 'Edit source' : 'View formatted'}
        class="cursor-pointer rounded border border-current px-2 py-1 disabled:cursor-default disabled:opacity-50"
        disabled={!!unavailable()} aria-describedby={unavailable() ? reasonId : undefined}
        onClick={() => setFormatted((value) => !value)}>
        {formatted() ? 'Edit source' : 'View formatted'}
      </button>
      <Show when={unavailable()}>{(reason) => <span id={reasonId} hidden>{reason()}</span>}</Show>
    </div>
    <div class={`min-h-0 flex-1 ${formatted() ? 'hidden' : ''}`}>
      <Suspense fallback={<p role="status" class="p-3 text-sm">Loading rich editor…</p>}><Editor {...props} /></Suspense>
    </div>
    <Show when={formatted()}>
      <div class="min-h-0 flex-1">
        <Show when={!error()} fallback={<p role="alert" class="p-3 text-sm">Couldn’t format this draft. Check the JSX syntax in Edit source and try again.</p>}>
          <Show when={preview()?.source === props.value ? preview() : null} fallback={<p role="status" class="p-3 text-sm">Formatting preview…</p>}>
            {(ready) => <Suspense><Editor value={ready().text} revision={props.revision} onChange={() => {}} readOnly ariaLabel="Formatted JSX" /></Suspense>}
          </Show>
        </Show>
      </div>
    </Show>
  </div>;
}
