import { waitFor } from '@testing-library/dom';
import { afterEach, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import {
  commentDocument,
  commentMarkdown,
  mountCommentEditor,
} from "../comment-editor";
import { fireEvent } from "../../__tests__/helpers";
import { replaceComment } from "./comment-input";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});
function mount(value = "") {
  const root = document.createElement("div");
  document.body.append(root);
  const onChange = vi.fn();
  const onMention = vi.fn();
  const editor = mountCommentEditor(root, {
    value: () => value,
    label: "Comment",
    placeholder: "Write a comment ...",
    onChange,
    onMention,
    onKey: () => false,
  });
  cleanups.push(() => {
    editor.destroy();
    root.remove();
  });
  return { ...editor, onChange, onMention };
}
it.each([
  "plain text",
  "**bold** and _italic_ and `code`",
  "- first\n- second",
  "> quoted",
  "```ts\nconst x = 1;\n```",
  `[@koala-8e44ad](/chat?session=${"a".repeat(64)}) hello`,
])("round-trips supported Markdown: %s", (text) => {
  expect(commentMarkdown(commentDocument(text))).toBe(text);
});
it("renders mentions as atomic colored badges and preserves their destination through edits", () => {
  const mention = `[@koala-8e44ad](/chat?session=${"a".repeat(64)})`;
  const editor = mount(mention + " ");
  const badge = editor.view.dom.querySelector("[data-comment-mention]")!;
  expect(badge).toHaveAttribute("contenteditable", "false");
  expect(badge).toHaveStyle({ "--mention-color": "#8e44ad" });
  editor.view.dispatch(editor.view.state.tr.insertText("hello", 3));
  expect(editor.onChange).toHaveBeenLastCalledWith(mention + " hello");
  editor.view.dispatch(editor.view.state.tr.delete(1, 2));
  expect(editor.onChange).toHaveBeenLastCalledWith(" hello");
});
it("pastes Markdown as formatting, ignores HTML, and supports undo and redo", () => {
  const editor = mount();
  replaceComment(editor.view.dom, "**hello**");
  expect(editor.view.dom.querySelector("strong")?.textContent).toBe("hello");
  expect(editor.onChange).toHaveBeenLastCalledWith("**hello**");
  fireEvent.keyDown(editor.view.dom, { key: "z", ctrlKey: true });
  expect(editor.view.dom.textContent).toBe("");
  fireEvent.keyDown(editor.view.dom, {
    key: "z",
    ctrlKey: true,
    shiftKey: true,
  });
  expect(editor.view.dom.textContent).toBe("hello");
  replaceComment(editor.view.dom, "<img src=x onerror=alert(1)>");
  expect(editor.view.dom.querySelector("img")).toBeNull();
  expect(editor.view.dom.textContent).toBe("<img src=x onerror=alert(1)>");
});
it("turns typed Markdown into a mark without losing the caret", () => {
  const editor = mount();
  for (const char of "**bold**") {
    const pos = editor.view.state.selection.from;
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, pos, pos, char, () => editor.view.state.tr),
    );
    if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(char));
  }
  expect(editor.view.dom.querySelector("strong")?.textContent).toBe("bold");
  expect(editor.onChange).toHaveBeenLastCalledWith("**bold**");
});
it("rejects unsafe links and keeps the document unchanged", () => {
  const editor = mount("hello");
  editor.view.dispatch(
    editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, 1, 6),
    ),
  );
  expect(editor.link("javascript:alert(1)")).toBe(false);
  expect(editor.view.dom.querySelector("a")).toBeNull();
  expect(editor.link("https://example.com")).toBe(true);
  expect(editor.onChange).toHaveBeenLastCalledWith(
    "[hello](https://example.com)",
  );
});
it("keeps literal Markdown characters literal across saving and reopening", () => {
  const editor = mount();
  editor.view.dispatch(
    editor.view.state.tr.insertText("literal **stars** and file_name_here"),
  );
  const reopened = commentDocument(commentMarkdown(editor.view.state.doc));
  expect(reopened.eq(editor.view.state.doc)).toBe(true);
});
it("keeps formatting valid when the selection includes surrounding spaces", () => {
  const editor = mount("a bold word");
  editor.view.dispatch(
    editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, 2, 8),
    ),
  );
  editor.format("bold");
  const reopened = commentDocument(commentMarkdown(editor.view.state.doc));
  expect(reopened.textContent).toBe("a bold word");
  expect(reopened.firstChild?.child(1).marks[0]?.type.name).toBe("strong");
});

it('retains formatting when browser input changes the text DOM', async () => {
  const editor=mount('**hello**');
  editor.view.dom.querySelector('strong')!.firstChild!.textContent='hello there';
  await waitFor(()=>expect(editor.onChange).toHaveBeenLastCalledWith('**hello there**'));
});
it('copies a selected badge as Markdown with its original destination',()=>{
  const source=`[@koala](/chat?session=${'a'.repeat(64)})`;
  const editor=mount(source);
  const slice=editor.view.state.doc.slice(1,2);
  expect(editor.view.someProp('clipboardTextSerializer',fn=>fn(slice,editor.view))).toBe(source);
});
it.each(['initial', 'late'] as const)('places the caret after an %s prefilled agent mention', mode => {
  const prefix = `[@koala](/chat?session=${'a'.repeat(64)}) `;
  const editor = mount(mode === 'initial' ? prefix : '');
  if (mode === 'late') editor.sync(prefix);
  editor.view.dispatch(editor.view.state.tr.insertText('Please review'));
  expect(editor.onChange).toHaveBeenLastCalledWith(prefix + 'Please review');
});
it('turns ## and a space into a heading and saves Markdown', () => {
  const editor = mount();
  for (const char of '## This is a heading') {
    const pos = editor.view.state.selection.from;
    const handled = editor.view.someProp('handleTextInput', fn => fn(editor.view, pos, pos, char, () => editor.view.state.tr));
    if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(char));
  }
  expect(editor.view.dom.querySelector('h2')?.textContent).toBe('This is a heading');
  expect(editor.onChange).toHaveBeenLastCalledWith('## This is a heading');
  fireEvent.keyDown(editor.view.dom, {key:'Enter'});
  expect(editor.view.state.selection.$from.parent.type.name).toBe('paragraph');
});

it('indents and outdents every selected code line with standard local undo', () => {
  const editor = mount('```ts\none\ntwo\n```');
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 8)));
  fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
  expect(editor.view.dom.querySelector('pre')?.textContent).toBe('  one\n  two');
  fireEvent.keyDown(editor.view.dom, { key: 'Tab', shiftKey: true });
  expect(editor.view.dom.querySelector('pre')?.textContent).toBe('one\ntwo');
  editor.view.dispatch(editor.view.state.tr.insertText('changed', 1, 4));
  fireEvent.keyDown(editor.view.dom, { key: 'z', ctrlKey: true });
  expect(editor.view.dom.querySelector('pre')?.textContent).toBe('one\ntwo');
});

it('does not undo into another comment after syncing a new draft', () => {
  const editor = mount('first draft');
  editor.view.dispatch(editor.view.state.tr.insertText(' changed'));
  editor.sync('second draft');
  fireEvent.keyDown(editor.view.dom, { key: 'z', ctrlKey: true });
  expect(editor.view.dom.textContent).toBe('second draft');
});
it('native comments preserve HTML clipboard formatting and paste literal text into code',()=>{
 const editor=mount();
 const html='<p><strong>Copied</strong> <em>format</em></p>';
 const event=new Event('paste') as ClipboardEvent;
 Object.defineProperty(event,'clipboardData',{value:{getData:(kind:string)=>kind==='text/html'?html:kind==='text/plain'?'Copied format':''}});
 editor.view.pasteHTML(html,event);
 expect(editor.onChange).toHaveBeenLastCalledWith('**Copied** _format_');
 const code=mount('```js\n\n```');
 const literal=new Event('paste') as ClipboardEvent;
 Object.defineProperty(literal,'clipboardData',{value:{getData:(kind:string)=>kind==='text/plain'?'**literal**':''}});
 code.view.pasteText('**literal**',literal);
 expect(code.view.state.doc.firstChild?.textContent).toBe('**literal**');
});

it('highlights code as decorations without changing Markdown or local history', () => {
  const source='```ts\nconst answer = 42;\n```';
  const editor=mount(source);
  expect(editor.view.dom.querySelector('.mx-code-token-keyword')?.textContent).toBe('const');
  expect(commentMarkdown(editor.view.state.doc)).toBe(source);
  editor.view.dispatch(editor.view.state.tr.insertText('x', 7));
  fireEvent.keyDown(editor.view.dom,{key:'z',ctrlKey:true});
  expect(commentMarkdown(editor.view.state.doc)).toBe(source);
  expect(editor.view.state.doc.toJSON()).not.toHaveProperty('decorations');
});

// Clipboard events must update placeholder state along with the editor document.
it.each(['A short draft', 'First line\nSecond line'])('hides the placeholder after pasting %s into an empty composer, and restores it on undo', text => {
  const editor = mount();
  expect(editor.view.dom).toHaveAttribute('aria-placeholder', 'Write a comment ...');
  replaceComment(editor.view.dom, text);
  expect(editor.view.state.doc.textContent).toBe(text.replace('\n', ''));
  expect(editor.view.dom).toHaveAttribute('data-empty', 'false');
  expect(editor.onChange).toHaveBeenLastCalledWith(text);
  fireEvent.keyDown(editor.view.dom, {key: 'z', ctrlKey: true});
  expect(editor.view.dom).toHaveAttribute('data-empty', 'true');
  fireEvent.keyDown(editor.view.dom, {key: 'z', ctrlKey: true, shiftKey: true});
  expect(editor.view.dom).toHaveAttribute('data-empty', 'false');
});
it('keeps the placeholder hidden when pasting after typing and restores it when cleared or synced', async () => {
  const editor = mount();
  // Native typing is observed through ProseMirror's DOM observer.
  editor.view.dom.querySelector('p')!.insertBefore(document.createTextNode('Typed '), editor.view.dom.querySelector('br'));
  await waitFor(() => expect(editor.onChange).toHaveBeenLastCalledWith('Typed '));
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
  fireEvent.paste(editor.view.dom, {clipboardData: {getData: (type: string) => type === 'text/plain' ? 'and pasted' : '', files: [], types: ['text/plain']}});
  expect(editor.onChange).toHaveBeenLastCalledWith('Typed and pasted');
  expect(editor.view.dom).toHaveAttribute('data-empty', 'false');
  fireEvent.keyDown(editor.view.dom, {key: 'a', ctrlKey: true});
  fireEvent.keyDown(editor.view.dom, {key: 'Backspace'});
  expect(editor.view.dom).toHaveAttribute('data-empty', 'true');
  editor.sync('A restored draft');
  expect(editor.view.dom).toHaveAttribute('data-empty', 'false');
  editor.sync('');
  expect(editor.view.dom).toHaveAttribute('data-empty', 'true');
});
