'use client';

/**
 * THE MARKUP SOURCE EDITOR, SERVED FROM THIS ORIGIN.
 *
 * `@monaco-editor/react` does not contain Monaco. Left alone it injects a
 * <script> pointing at jsdelivr and waits for it — and the app's own CSP
 * (`script-src 'self'`, server/app.ts) refuses that, so `code` mode showed
 * "Loading…" forever, in development and on the deployment alike. It had never
 * worked. Nothing in the unit suite could see it either: the editor's UI test
 * mocks `@monaco-editor/react`, so the loader never runs there — which is why
 * the guard for this lives in scripts/gate-editor-flow.mjs, where a real
 * browser really loads it.
 *
 * `loader.config({ monaco })` hands the library the instance we bundled, and it
 * resolves straight from that without ever creating the script tag. The CSP is
 * therefore left as tight as it was; the one thing it gains is `worker-src
 * 'self'`, which is insurance rather than a fix — the worker below is lazy and
 * nothing has yet asked for it, but `worker-src` falls back to
 * `default-src 'none'`, so the first feature that does would be refused
 * silently.
 *
 * Two deliberate narrowings, both to keep the chunk honest:
 *
 *  - The SLIM entry (`editor.api`) plus the HTML *tokenizer*, and NOT
 *    `vs/language/html` — the language SERVICE. Story markup is not HTML: it
 *    carries `<Helmet>`, `<Question>` and `className`, so an HTML validator
 *    underlines correct documents, and the service costs a 720 KB worker to do
 *    it (measured). Colours are what a source pane is for here.
 *  - The whole module sits behind InPlaceEditor's dynamic import, so a reader —
 *    and an owner who never opens `code` — pays nothing. That boundary is
 *    enforced by lib/__tests__/reader-bundle-hygiene.
 */
import Editor, { loader } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

declare global {
  // Monaco reads this off the global to find its worker; it declares no type
  // for it on Window, and the worker is constructed in both realms.
  // eslint-disable-next-line no-var
  var MonacoEnvironment: monaco.Environment | undefined;
}

/**
 * Monaco requires this hook to exist; without it, the first feature to want a
 * worker throws rather than degrading. It is genuinely lazy — typing and an
 * explicit suggestion request both left `getWorker` uncalled and `page.workers()`
 * empty — so the chunk is emitted and never fetched. Vite emits it as an
 * ordinary same-origin asset (measured: `new Worker('/assets/editor.worker-<hash>.js')`,
 * not a `blob:`), which is what lets the CSP admit it with `'self'` alone.
 */
globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };

// Module scope, so it is configured before any <Editor> can start loading.
loader.config({ monaco });

/**
 * MONACO OWNS THE BUFFER; A REPLACEMENT IS ANNOUNCED, NEVER INFERRED.
 *
 * A controlled `<Editor value>` is a race, and a nasty one: each keystroke sets
 * React state, and a render that lands one keystroke behind hands the wrapper a
 * STALE string, which it dutifully writes back into the model — wiping whatever
 * was typed in between and taking the caret with it. Measured at full typing
 * speed against the real editor: "typed in code mode" reached the SERVER as
 * "typemode"; the same words at 150ms a key arrived whole. No hand test finds
 * that, and no jsdom test can (Monaco does not run there), so
 * scripts/gate-editor-flow.mjs types with no delay and compares exactly.
 *
 * Guarding on "is `value` what I last emitted?" is the obvious fix and is the
 * SAME BUG one step along: two keystrokes before a render make the effect's
 * `value` stale against a model that has both, and it writes the older one
 * back. There is no way to tell a stale echo from a real replacement by looking
 * at the text, so the editor stops trying — `revision` is the parent saying
 * "this `value` came from somewhere else". Local typing therefore never writes
 * to the model at all, and a live edit or a 409 rebase still lands.
 */
export default function SourceEditor({ value, revision, onChange }: {
  value: string;
  /**
   * Bumped by the caller whenever `value` was replaced from OUTSIDE this editor
   * — a collaborator's live edit, a 409 rebase. It is the ONLY thing that moves
   * the model; `value` changing on its own means the caller is echoing our own
   * typing back, which must be a no-op.
   */
  revision: number;
  /** Every keystroke; the caller owns debouncing it into a save. */
  onChange: (next: string) => void;
}) {
  const editorRef = useRef<Parameters<NonNullable<React.ComponentProps<typeof Editor>['onMount']>>[0] | null>(null);
  /** Read at replacement time, so a stale render cannot supply the text. */
  const latest = useRef(value);
  latest.current = value;

  const emit = useCallback((next: string | undefined) => onChange(next ?? ''), [onChange]);

  useEffect(() => {
    const editor = editorRef.current;
    const next = latest.current;
    if (!editor || editor.getModel()?.getValue() === next) return;
    // Someone else moved the document. Keep the caret where the person left it;
    // the position may no longer exist, and Monaco clamps it for us.
    const position = editor.getPosition();
    editor.setValue(next);
    if (position) editor.setPosition(position);
  }, [revision]);

  return (
    <Editor
      height="100%"
      defaultLanguage="html"
      defaultValue={value}
      onMount={(editor) => { editorRef.current = editor; }}
      onChange={emit}
      theme="vs-dark"
      options={{
        minimap: { enabled: false }, fontSize: 12, wordWrap: 'on',
        scrollBeyondLastLine: false, automaticLayout: true,
        // Every interactive element gets a label (house rule); Monaco's own
        // textarea takes it from here.
        ariaLabel: 'Markup source',
      }}
    />
  );
}
