/* @jsxImportSource solid-js */
/**
 * The JSX source editor with a read-only "View formatted"
 * preview. The editable editor stays mounted (hidden) while the preview shows, so its draft,
 * selection and undo history survive the round trip; the preview owns a separate read-only editor.
 *
 * FeatureGate's tooltip stays in the shell (the reason is the button's description only).
 */
import { createEffect, createSignal, createUniqueId, lazy, onCleanup, Show, Suspense } from 'solid-js';
import type { SourceEditorProps } from './SourceEditor';
import { useSourceEditorTools } from './source-editor-tools';

function PlainSourceFallback(props: SourceEditorProps & { unavailable?: string | null; remember: (selection: { start: number; end: number } | null) => void }) {
  let input!: HTMLTextAreaElement;
  onCleanup(() => {
    const scope = input?.getRootNode() as Document | ShadowRoot | undefined;
    if (input && scope?.activeElement === input)
      props.remember({ start: input.selectionStart, end: input.selectionEnd });
  });
  return <div class="flex h-full w-full flex-col" style={{ 'background-color': '#1e1e1e', color: '#d4d4d4' }}>
    <div class="relative flex min-h-0 flex-1 overflow-hidden" style={{ 'font-family': 'Menlo, Monaco, Consolas, monospace', 'font-size': '12px', 'line-height': '18px' }}>
      <div aria-hidden="true" class="w-12 shrink-0 overflow-hidden text-right" style={{ color: '#858585' }}>
        <pre data-source-line-numbers class="m-0 py-2 pr-3" style={{ font: 'inherit' }}>{props.value.split('\n').map((_, index) => index + 1).join('\n')}</pre>
      </div>
      <textarea ref={input} aria-label={props.ariaLabel ?? 'Markup source'} aria-description={props.unavailable ?? undefined} readOnly={props.readOnly}
        class="min-h-0 min-w-0 flex-1 resize-none border-0 px-1 py-2 outline-none"
        style={{ 'background-color': '#1e1e1e', color: '#d4d4d4', font: 'inherit', 'tab-size': '2' }} wrap="off"
        spellcheck={false} autocapitalize="off" value={props.value}
        on:input={(event) => {
          props.remember({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
          props.onChange(event.currentTarget.value);
        }}
        on:scroll={(event) => { const numbers = event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-source-line-numbers]'); if (numbers) numbers.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`; }} />
    </div>
    <div class="px-3 py-2 text-xs" style={{ color: '#a0a0a0', 'border-top': '1px solid #333' }} role="status">{props.unavailable ?? 'Loading rich editor… You can keep editing.'}</div>
  </div>;
}

export default function SourceEditorPane(props: SourceEditorProps) {
  const tools = useSourceEditorTools();
  const Editor = lazy(tools.editor);
  const reasonId = createUniqueId();
  const [formatted, setFormatted] = createSignal(false);
  const [preview, setPreview] = createSignal<{ source: string; text: string } | null>(null);
  const [error, setError] = createSignal(false);
  let handoff: { start: number; end: number } | null = null;
  const [plainDraft, setPlainDraft] = createSignal<{ text: string; revision: number } | null>(null);
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
        on:click={() => setFormatted((value) => !value)}>
        {formatted() ? 'Edit source' : 'View formatted'}
      </button>
      <Show when={unavailable()}>{(reason) => <span id={reasonId} hidden>{reason()}</span>}</Show>
    </div>
    <div class={`min-h-0 flex-1 ${formatted() ? 'hidden' : ''}`}>
      <Suspense fallback={<PlainSourceFallback {...props} unavailable={tools.editorUnavailable}
        onChange={(text) => { setPlainDraft({ text, revision: props.revision }); props.onChange(text); }}
        remember={(selection) => { if (selection) handoff = selection; }} />}>
        <Editor {...props} value={plainDraft()?.revision === props.revision ? plainDraft()!.text : props.value}
          initialSelection={() => handoff ?? props.initialSelection?.() ?? null} />
      </Suspense>
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
