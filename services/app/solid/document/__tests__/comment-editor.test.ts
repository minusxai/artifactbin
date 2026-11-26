import { waitFor } from '@testing-library/dom';
import { afterEach, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import {
  commentDocument,
  commentMarkdown,
  mountCommentEditor,
} from "../comment-editor";
import { loadCodeHighlighting } from "@/lib/markdown/editor";
import { fireEvent } from "../../__tests__/helpers";
import { replaceComment } from "./comment-input";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});
function mount(value = "", artifactId?: string) {
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
    artifactId,
  });
  cleanups.push(() => {
    editor.destroy();
    root.remove();
  });
  return { ...editor, onChange, onMention };
}
it.each([
  "plain text",
  "**bold** and *italic* and `code`",
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
  // A line's leading space is not saved (Markdown would drop it; the module would write `&#32;`).
  expect(editor.onChange).toHaveBeenLastCalledWith("hello");
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
it("uses Control+E to move to the end and Mod+Shift+E for inline code", () => {
  const { view, onChange } = mount("First\n\nLast");
  const selectFirst = () =>
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
  selectFirst();
  fireEvent.keyDown(view.dom, { key: "e", ctrlKey: true });
  expect(view.state.selection.eq(TextSelection.create(view.state.doc, 6))).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  selectFirst();
  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  fireEvent.keyDown(view.dom, { key: "E", keyCode: 69, ctrlKey: !mac, metaKey: mac, shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith("`First`\n\nLast");
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
  expect(reopened.firstChild?.child(1).marks[0]?.type.name).toBe("bold");
  // The spaces the selection took in move outside the run, as the comment box always saved them.
  expect(commentMarkdown(editor.view.state.doc)).toBe("a **bold** word");
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
 expect(editor.onChange).toHaveBeenLastCalledWith('**Copied** *format*');
 const code=mount('```js\n\n```');
 const literal=new Event('paste') as ClipboardEvent;
 Object.defineProperty(literal,'clipboardData',{value:{getData:(kind:string)=>kind==='text/plain'?'**literal**':''}});
 code.view.pasteText('**literal**',literal);
 expect(code.view.state.doc.firstChild?.textContent).toBe('**literal**');
});

it('highlights code as decorations without changing Markdown or local history', async () => {
  await loadCodeHighlighting();
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
  // The trailing space is not saved; the editor keeps it, so typing goes on after it.
  await waitFor(() => expect(editor.onChange).toHaveBeenLastCalledWith('Typed'));
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

it("saves the agreed Markdown for italic written with underscores", () => {
  expect(commentMarkdown(commentDocument("_italic_ and snake_case"))).toBe("*italic* and snake_case");
});
it.each([
  "# Title\n\nA **bold** word, ~~struck~~ and [a link](https://example.com \"its title\").",
  "- [ ] open\n- [x] done",
  "3. third\n4. fourth",
  "| a | b |\n| --- | ---: |\n| `x` | y |",
  "![a chart](https://example.com/c.png) and ![upload](ref:abc123XYZ)",
  "first line\nsecond line",
  "```\n  indented code\n```",
  "> quoted [**@asha**](/api/people/usr_asha) reply",
  `## Ask [@koala](/chat?session=${"a".repeat(64)})`,
  "| who |\n| --- |\n| [@asha](/people/usr_asha) |",
  "- item with [@bo](/people/usr_bo)",
  "---",
])("loads and saves canonical text unchanged: %s", (text) => {
  const doc = commentDocument(text);
  doc.check();
  expect(commentMarkdown(doc)).toBe(text);
});
it("makes a mention in a heading, a table cell, a list item and a quote one badge", () => {
  const doc = commentDocument(`## [@a](/people/usr_a)\n\n| [@b](/people/usr_b) |\n| --- |\n\n- [@c](/people/usr_c)\n\n> [@d](/people/usr_d)`);
  doc.check();
  const mentions: string[] = [];
  doc.descendants((node) => { if (node.type.name === "mention") mentions.push(node.attrs.href); });
  expect(mentions).toEqual(["/people/usr_a", "/people/usr_b", "/people/usr_c", "/people/usr_d"]);
});
it("publishes nothing while a body is only loaded, and keeps an untouched code fence exact through an edit elsewhere", () => {
  const source = "Intro\n\n```py\n  indented = True  \n```";
  const editor = mount(source);
  expect(editor.onChange).not.toHaveBeenCalled();
  editor.view.dispatch(editor.view.state.tr.insertText("!", 6));
  expect(editor.onChange).toHaveBeenLastCalledWith("Intro!\n\n```py\n  indented = True  \n```");
});
it("keeps a table written in a body through an edit, and offers no table commands", () => {
  const editor = mount("Note\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  expect(editor.view.dom.querySelector("table")).not.toBeNull();
  editor.view.dispatch(editor.view.state.tr.insertText("s", 5));
  expect(editor.onChange).toHaveBeenLastCalledWith("Notes\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  expect(Object.keys(editor.view.state.schema.nodes)).toContain("table");
  const commands = Object.keys((editor.view as unknown as { dom: { editor?: { commands: object } } }).dom.editor?.commands ?? {});
  expect(commands).toContain("toggleBold");
  expect(commands.filter((name) => /table|cell|row|column/i.test(name))).toEqual([]);
});
it("shows an image through the document's asset route, an upload at its own address, and no other source without a document", () => {
  const body = "![chart](https://example.com/c.png) ![mine](ref:abc123XYZ)";
  const images = (editor: { view: { dom: Element } }) => [...editor.view.dom.querySelectorAll("img:not(.ProseMirror-separator)")].map((img) => img.getAttribute("src"));
  const routed = mount(body, "doc1");
  expect(images(routed)).toEqual([
    `/a/doc1/assets?u=${encodeURIComponent("https://example.com/c.png")}`, "/a/abc123XYZ/raw",
  ]);
  const alone = mount(body);
  expect(images(alone)).toEqual([null, "/a/abc123XYZ/raw"]);
  expect(alone.view.dom.innerHTML).not.toContain("example.com");
});
it("inserts a picked mention as a badge and saves it as its link", () => {
  const editor = mount("hi @as");
  editor.mention({ from: 4, to: 7, query: "as" }, "[@asha](/api/people/usr_asha)");
  expect(editor.view.dom.querySelector("[data-comment-mention]")?.textContent).toBe("@asha");
  expect(editor.onChange).toHaveBeenLastCalledWith("hi [@asha](/api/people/usr_asha)");
});
it("does not italicise inside a word while typing", () => {
  const editor = mount();
  for (const char of "snake_case_x_") {
    const pos = editor.view.state.selection.from;
    const handled = editor.view.someProp("handleTextInput", (fn) => fn(editor.view, pos, pos, char, () => editor.view.state.tr));
    if (!handled) editor.view.dispatch(editor.view.state.tr.insertText(char));
  }
  expect(editor.view.dom.querySelector("em")).toBeNull();
  // The serializer escapes the closing `_` at the run's edge, so the saved text reads back as typed.
  expect(editor.onChange).toHaveBeenLastCalledWith("snake_case_x\\_");
});
