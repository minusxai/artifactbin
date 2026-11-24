/**
 * <af-markdown-editor>: a rich text field whose value is Markdown: headings, bold, italic,
 *   strikethrough, inline code, lists, quotes, code blocks, tables and dividers, from a toolbar,
 *   shortcuts (Mod-B, Mod-I, Mod-Shift-X, Mod-Shift-E) or typed Markdown (`# `, `- `, `**bold**`).
 * Usage: import '@afbin/markdown-editor';  (registers the tag; this .ts is the readable contract)
 * Props: value (Markdown string), label, placeholder, rows (minimum height), disabled, readonly.
 * Events: af-change (bubbles) with event.detail.value: the Markdown, or null when empty.
 * Examples:
 *   <af-markdown-editor label="Notes" rows="6" placeholder="Write…"></af-markdown-editor>
 *   <af-markdown-editor default-value="## Revenue&#10;Net of discounts."></af-markdown-editor>
 * Gotchas: Markdown mode edits exact source. Reflect your value back for controlled use. Visual
 *   edits normalize Markdown spelling. HTML and image syntax stay literal in the visual editor.
 */
import { EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { NamedHost, hostName, movingName } from './host-name';
import { registerComponent } from './register-component';
import { editorPlugins, toolbarGroups, type EditorAction } from './markdown-editor-commands';
import { normalizeMarkdown, parseMarkdown, serializeMarkdown } from './markdown-editor-model';
import { inTable } from './markdown-editor-table-commands';
import { sourceMode } from './markdown-editor-source';
import { tableMenu } from './markdown-editor-table-menu';
import { MARKDOWN_ROOT } from './markdown-styles';
import { markdownEditorStyles } from './markdown-editor-styles';
/** Author-facing contract: the Markdown value, null when the field is empty. */
interface MarkdownEditorContract { value: string | null | undefined }

let nextEditorId = 0;
const empty = (doc: EditorState['doc']) => doc.childCount === 1 && doc.firstChild!.isTextblock &&
  doc.firstChild!.content.size === 0;

class AfMarkdownEditor extends NamedHost implements MarkdownEditorContract {
  static observedAttributes = ['value', 'label', 'aria-label', 'placeholder', 'rows', 'disabled',
    'readonly'];
  private view?: EditorView;
  private label?: HTMLLabelElement;
  private buttons: Array<[EditorAction, HTMLButtonElement]> = [];
  private mode?: ReturnType<typeof sourceMode>;
  private refreshTable?: () => void;
  private accepted = '';
  private propertyControlled = false;
  private propertyValue: string | null | undefined;
  private initial?: string;

  get value(): string | null {
    if (this.propertyControlled) return this.propertyValue || null;
    if (this.hasAttribute('value')) return this.getAttribute('value') || null;
    return this.view ? this.accepted || null : this.initialSource() || null;
  }
  set value(value: string | null | undefined) {
    this.propertyControlled = value !== undefined;
    this.propertyValue = value;
    this.sync();
  }

  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'value')) {
      const value = this.value; delete (this as { value?: string | null }).value;
      this.value = value;
    }
    if (!this.view) this.mount();
    this.sync();
  }
  disconnectedCallback(): void { /* the view survives moves; it holds no outside resources */ }
  attributeChangedCallback(): void { if (!movingName(this)) this.sync(); }

  private controlled(): boolean { return this.propertyControlled || this.hasAttribute('value'); }
  private initialSource(): string {
    this.initial ??= this.getAttribute('default-value') ?? [...this.childNodes]
      .filter(node => node.nodeType === 3).map(node => node.textContent ?? '').join('');
    return this.initial;
  }
  private editable(): boolean { return !this.hasAttribute('disabled') &&
    !this.hasAttribute('readonly'); }

  private mount(): void {
    const doc = this.ownerDocument;
    const source = this.controlled() ? this.value ?? '' : this.initialSource();
    for (const node of [...this.childNodes]) if (node.nodeType === 3) node.remove();
    const id = `af-markdown-editor-${++nextEditorId}`;
    this.label = doc.createElement('label'); this.label.dataset.afControlLabel = '';
    this.label.id = `${id}-label`;
    this.label.addEventListener('click', () => {
      if (this.mode?.field.hidden) this.view?.focus(); else this.mode?.field.focus();
    });
    const frame = doc.createElement('div'); frame.className = 'af-md-frame';
    const toolbar = doc.createElement('div'); toolbar.className = 'af-md-toolbar';
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Formatting');
    toolbarGroups.forEach((group, index) => {
      if (index) { const gap = doc.createElement('span'); gap.setAttribute('role', 'separator');
        toolbar.append(gap); }
      for (const action of group) toolbar.append(this.button(action));
    });
    const surface = doc.createElement('div');
    frame.append(toolbar);
    this.refreshTable = tableMenu(toolbar, frame, `${id}-table`, () => this.view!,
      () => this.editable());
    frame.append(surface);
    this.mode = sourceMode(this, frame, toolbar, surface, id, () => this.value ?? '',
      source => this.change(source), () => this.sync());
    this.append(this.label, frame);
    const state = EditorState.create({ doc: parseMarkdown(source), plugins: editorPlugins() });
    this.accepted = source;
    this.view = new EditorView(surface, {
      state,
      editable: () => this.editable(),
      attributes: current => ({
        class: `af-md-editable ${MARKDOWN_ROOT.slice(1)}`, role: 'textbox',
        'aria-multiline': 'true', 'aria-labelledby': this.label!.id,
        ...(this.hasAttribute('readonly') ? { 'aria-readonly': 'true' } : {}),
        ...(this.hasAttribute('disabled') ? { 'aria-disabled': 'true' } : {}),
        ...(empty(current.doc) ? { 'data-empty': '' } : {}),
        'data-placeholder': this.getAttribute('placeholder') ?? '',
      }),
      dispatchTransaction: transaction => this.apply(transaction),
    });
  }

  private button(action: EditorAction): HTMLButtonElement {
    const button = this.ownerDocument.createElement('button');
    button.type = 'button'; button.textContent = action.label; button.dataset.key = action.key;
    button.title = action.title; button.setAttribute('aria-label', action.title);
    if (action.active) button.setAttribute('aria-pressed', 'false');
    // Keep the caret in the text: the toolbar acts on the selection the editor already has.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      const view = this.view; if (!view || !this.editable()) return;
      action.run(view.state, view.dispatch, view); view.focus();
    });
    this.buttons.push([action, button]);
    return button;
  }

  private apply(transaction: Transaction): void {
    const view = this.view!;
    view.updateState(view.state.apply(transaction));
    this.refreshToolbar();
    if (!transaction.docChanged || transaction.getMeta(EXTERNAL)) return;
    this.change(serializeMarkdown(view.state.doc));
  }

  private change(value: string): void {
    if (value === this.accepted) return;
    const accepted = this.dispatchEvent(new CustomEvent('af-change', { detail: { value:
      value || null }, bubbles: true, composed: true, cancelable: true }));
    if (this.controlled()) this.sync();
    else if (!accepted) this.sync();
    else this.accepted = value;
  }

  /** Swap in new content without an undo step, keeping the caret where the text allows. */
  private replace(source: string): void {
    const view = this.view!;
    const next = parseMarkdown(source);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content)
      .setMeta('addToHistory', false).setMeta(EXTERNAL, true));
    this.accepted = source;
  }

  private sync(): void {
    const view = this.view; if (!view || !this.isConnected) return;
    const visible = this.getAttribute('label'); const named = hostName(this);
    this.label!.textContent = visible ?? named ?? '';
    this.label!.hidden = !visible;
    if (!visible && named) view.dom.setAttribute('aria-label', named);
    else view.dom.removeAttribute('aria-label');
    const rows = Number(this.getAttribute('rows'));
    const minimum = Number.isInteger(rows) && rows > 0 ? rows : 3;
    view.dom.style.setProperty('--af-md-rows', String(minimum));
    this.mode!.sync(visible || named, minimum);
    const value = this.value ?? '';
    if (this.mode!.field.hidden && !view.composing) {
      const current = serializeMarkdown(view.state.doc);
      if (value !== current && normalizeMarkdown(value) !== normalizeMarkdown(current)) {
        this.replace(value);
      }
    }
    this.accepted = value;
    view.setProps({});
    this.refreshToolbar();
  }

  private refreshToolbar(): void {
    const state = this.view?.state; if (!state) return;
    this.refreshTable?.();
    const inCell = inTable(state);
    for (const [action, button] of this.buttons) {
      button.disabled = !this.editable() || (inCell && !action.run(state));
      if (action.active) button.setAttribute('aria-pressed', String(action.active(state)));
    }
  }
}
const EXTERNAL = 'af-markdown-editor-external';

registerComponent({
  styleKey: 'af-markdown-editor-styles',
  styles: markdownEditorStyles,
  elements: { 'af-markdown-editor': AfMarkdownEditor },
});
