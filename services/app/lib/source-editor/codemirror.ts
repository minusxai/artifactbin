/**
 * THE SOURCE PANE'S EDITOR ENGINE — CodeMirror 6, behind one call.
 *
 * Everything CodeMirror is imported here and nowhere else, so this module is
 * the whole engine: components/SourceEditor mounts it, and the offline build
 * (scripts/build-offline.mjs) swaps this one module for the copy the extras
 * bundle carries (lib/offline/extras-entry). CodeMirror's packages compare
 * their own instances, so they must always arrive together; one module is how
 * that stays true.
 *
 * Why CodeMirror and not Monaco: the pane needs colours, a caret, undo and
 * find, not an IDE. Monaco was ~730 KB gzipped for that, needed a worker hook,
 * a CDN-free loader and hand-mounted CSS in the TrustedUi shadow root, and is
 * poor on phones. CodeMirror mounts its styles into whatever root holds the
 * editor, runs no worker, and edits through a contenteditable the platform's
 * own text input drives.
 *
 * The language is JSX, which story markup is (`<Helmet>`, `className`, `{…}`);
 * highlighting only, no linting.
 */
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { jsxLanguage } from '@codemirror/lang-javascript';
import { tags as t } from '@lezer/highlight';

export interface SourceViewOptions {
  parent: HTMLElement;
  doc: string;
  readOnly: boolean;
  ariaLabel: string;
  /** Where to put the caret and focus on mount (character offsets); null leaves it unfocused. */
  selection: { start: number; end: number } | null;
  /** Every change the person makes. Never called for `replace`. */
  onChange(next: string): void;
}

export interface SourceView {
  /** Replace the whole buffer from outside, keeping the caret where it was (clamped). */
  replace(text: string): void;
  destroy(): void;
}

/** The plain editor's palette (components/LazySourceEditor), so the handoff does not flash. */
const BACKGROUND = '#1e1e1e', FOREGROUND = '#d4d4d4';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: BACKGROUND, color: FOREGROUND, fontSize: '12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'Menlo, Monaco, Consolas, monospace', lineHeight: '18px' },
  '.cm-content': { caretColor: '#aeafad' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#264f78' },
  '.cm-activeLine': { backgroundColor: '#ffffff0a' },
  '.cm-selectionMatch': { backgroundColor: '#add6ff26' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: '#0064001a', outline: '1px solid #888' },
  '.cm-gutters': { backgroundColor: BACKGROUND, color: '#858585', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c6c6c6' },
  '.cm-searchMatch': { backgroundColor: '#623315', outline: '1px solid #ea5c00' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#515c6a' },
  '.cm-panels': { backgroundColor: '#252526', color: FOREGROUND },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid #333' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #333' },
  '.cm-textfield': { backgroundColor: '#3c3c3c', color: FOREGROUND, border: '1px solid #3c3c3c' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: '#3c3c3c', color: FOREGROUND, border: '1px solid #555' },
}, { dark: true });

/** VS Code's dark colours for JSX, which is what the pane showed before. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#569cd6' },
  { tag: [t.tagName, t.angleBracket], color: '#569cd6' },
  { tag: t.attributeName, color: '#9cdcfe' },
  { tag: [t.string, t.attributeValue, t.special(t.string)], color: '#ce9178' },
  { tag: [t.number, t.bool, t.null], color: '#b5cea8' },
  { tag: [t.lineComment, t.blockComment], color: '#6a9955' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
  { tag: [t.variableName, t.propertyName], color: '#9cdcfe' },
  { tag: [t.typeName, t.className], color: '#4ec9b0' },
  { tag: [t.brace, t.bracket, t.paren, t.punctuation, t.operator], color: FOREGROUND },
  { tag: t.invalid, color: '#f44747' },
]);

export function createSourceView({ parent, doc, readOnly, ariaLabel, selection, onChange }: SourceViewOptions): SourceView {
  const clamp = (n: number, length: number) => Math.max(0, Math.min(n, length));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: selection ? EditorSelection.single(clamp(selection.start, doc.length), clamp(selection.end, doc.length)) : undefined,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        jsxLanguage,
        syntaxHighlighting(highlight),
        theme,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        // Every interactive element gets a label (house rule).
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          // `replace` is the parent's own text arriving; echoing it back would queue a save of what it already has.
          if (update.transactions.some((tr) => tr.annotation(Transaction.remote))) return;
          onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  if (selection) view.focus();

  return {
    replace(text) {
      const current = view.state.doc.toString();
      if (current === text) return;
      const { anchor, head } = view.state.selection.main;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: text },
        selection: EditorSelection.single(clamp(anchor, text.length), clamp(head, text.length)),
        annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
      });
    },
    destroy() { view.destroy(); },
  };
}
