/**
 * The comment box: a Tiptap editor on lib/markdown's shared elements (./editor-presets). Markdown is the public value
 * and DOM never crosses the wire: a body loads through the module's one parser (`parse`, images on) and saves through
 * its serializer, so a body nobody edits is never rewritten (only an edit publishes), and canonical text comes back
 * byte for byte. What comments add around the module:
 *
 * - A person or agent-session mention link is one Mention atom while edited, and a link again when saved.
 * - Whitespace Markdown cannot show is not saved as references: a line's leading and trailing spaces are dropped,
 *   and spaces just inside bold, italic or strikethrough move outside it (`a** bold **b` saves as `a **bold** b`).
 *   Comment bodies are plain text agents read; `&#32;` would be noise in them.
 * - Typing a closed `**bold**`, `*italic*`/`_italic_`, `` `code` `` or `[text](href)` turns it into its mark.
 */
import { Slice, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { Editor, getSchema } from "@tiptap/core";
import { toggleMark } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import type { MarkdownMark, MarkdownNode } from "@/lib/markdown/display";
import { parse, serialize } from "@/lib/markdown/editor";
import { linkAllowed } from "@/lib/markdown/href";
import { commentExtensions, isMentionHref } from "./editor-presets";
import { commentImageAddress, uploadAddress } from "./comment-display";

/** The composer toolbar's five verbs. */
export type MdMarker = "bold" | "italic" | "code" | "link" | "list";

const commentSchema = getSchema(commentExtensions());
const linkOf = (node: MarkdownNode) => node.marks?.find((mark) => mark.type === "link");

/** Inline JSON with each mention link as one Mention atom (a link whose label is split by formatting stays one). */
function withMentions(nodes: readonly MarkdownNode[]): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  let open: { node: MarkdownNode; link: MarkdownMark } | null = null;
  for (const node of nodes) {
    const link = node.type === "text" ? linkOf(node) : undefined;
    if (!link || !isMentionHref(link.attrs?.href ?? "")) {
      open = null;
      out.push(node.content ? { ...node, content: withMentions(node.content) } : node);
      continue;
    }
    if (open && open.link.attrs?.href === link.attrs?.href) {
      (open.node.attrs as { label: string }).label += node.text ?? "";
      continue;
    }
    const marks = node.marks!.filter((mark) => mark.type !== "link");
    const mention: MarkdownNode = { type: "mention", attrs: { label: node.text ?? "", href: link.attrs!.href }, ...(marks.length ? { marks } : {}) };
    out.push(mention);
    open = { node: mention, link };
  }
  return out;
}

const TEXTBLOCKS = new Set(["paragraph", "heading", "tableCell", "tableHeader"]);
const isCode = (node: MarkdownNode) => !!node.marks?.some((mark) => mark.type === "code");
const EMPHASIS = new Set(["bold", "italic", "strike"]);

/** Spaces at an emphasis run's edges, moved outside the run. */
function emphasisEdges(nodes: MarkdownNode[]): MarkdownNode[] {
  for (const type of EMPHASIS) {
    const has = (node: MarkdownNode | undefined) => !!node?.marks?.some((mark) => mark.type === type);
    for (let i = 0; i < nodes.length; i++) {
      if (!has(nodes[i]) || has(nodes[i - 1])) continue;
      let end = i;
      while (has(nodes[end + 1])) end++;
      const strip = (at: number, side: "start" | "end") => {
        const node = nodes[at]!;
        if (node.type !== "text" || isCode(node)) return 0;
        const text = node.text!, kept = side === "start" ? text.replace(/^[ \t]+/, "") : text.replace(/[ \t]+$/, "");
        if (kept === text || !kept) return 0;
        const space: MarkdownNode = { ...node, text: side === "start" ? text.slice(0, text.length - kept.length) : text.slice(kept.length), marks: node.marks!.filter((mark) => mark.type !== type) };
        if (!space.marks!.length) delete space.marks;
        nodes.splice(at, 1, ...(side === "start" ? [space, { ...node, text: kept }] : [{ ...node, text: kept }, space]));
        return 1;
      };
      const shift = strip(i, "start");
      strip(end + shift, "end");
      i = end + shift + 1;
    }
  }
  return nodes;
}

/** A textblock's inline content without the leading and trailing spaces of its lines. */
function trimLines(nodes: MarkdownNode[]): MarkdownNode[] {
  const out = [...nodes];
  const edge = (at: number, side: "start" | "end") => {
    const node = out[at];
    if (node?.type !== "text" || isCode(node)) return false;
    const text = node.text!.replace(side === "start" ? /^[ \t]+/ : /[ \t]+$/, "");
    if (text) { out[at] = { ...node, text }; return false; }
    out.splice(at, 1);
    return true;
  };
  for (let line = 0; line <= out.length; line++) {
    // `line` is the start of a line: the content's start, or just after a hard break.
    if (line > 0 && out[line - 1]?.type !== "hardBreak") continue;
    while (edge(line, "start"));
    let end = line;
    while (end < out.length && out[end]!.type !== "hardBreak") end++;
    while (end > line && edge(end - 1, "end")) end--;
  }
  return out;
}

/** The editor's document as the module's JSON: mentions as links, and no whitespace Markdown would encode. */
function savedJson(node: MarkdownNode): MarkdownNode {
  if (node.type === "mention") {
    const attrs = node.attrs as { label: string; href: string };
    return { type: "text", text: attrs.label, marks: [...(node.marks ?? []), { type: "link", attrs: { href: attrs.href, title: null } }] };
  }
  if (!node.content) return node;
  const content = node.content.map(savedJson).filter((child) => child.type !== "text" || child.text);
  // Prose only: a code block's text is kept exactly.
  return { ...node, content: TEXTBLOCKS.has(node.type) ? trimLines(emphasisEdges(content)) : content };
}

const commentNode = (json: MarkdownNode) => commentSchema.nodeFromJSON(json);
/**
 * A body as the editor's document. Spaces ending the body stay at the end of its last paragraph (Markdown drops
 * them), so a reply prefilled with a mention and a space continues after the space.
 */
export function commentDocument(markdown: string): PMNode {
  const doc = parse(markdown, { images: true });
  const content = doc.content.length ? withMentions(doc.content) : [{ type: "paragraph" }];
  const tail = /[ \t]+$/.exec(markdown)?.[0];
  const last = content.at(-1)!;
  if (tail && last.type === "paragraph") content[content.length - 1] = { ...last, content: [...(last.content ?? []), { type: "text", text: tail }] };
  return commentNode({ ...doc, content });
}
export function commentMarkdown(doc: PMNode): string {
  return serialize(commentNode(savedJson(doc.toJSON() as MarkdownNode)));
}
/** One textblock's inline nodes as Markdown (what copying an inline selection writes). */
const inlineMarkdown = (content: PMNode["content"]) => commentMarkdown(commentSchema.node("doc", null, [commentSchema.node("paragraph", null, content)]));
/** A typed construct's inline nodes, or null when the text holds no mark or mention. */
function typedInline(text: string): PMNode[] | null {
  const first = parse(text, { images: true }).content[0];
  if (first?.type !== "paragraph" || !first.content) return null;
  const nodes = withMentions(first.content).map(commentNode);
  return nodes.some((node) => node.marks.length || node.type.name === "mention") ? nodes : null;
}
/** An upload is the reader's own; any other source needs a document to be fetched through, so it is never shown. */
const noImageAddress = (src: string): string | Promise<string> =>
  uploadAddress(src) ?? new Promise<string>(() => {});
export interface MentionQuery {
  from: number;
  to: number;
  query: string;
}
export function mountCommentEditor(
  mount: HTMLElement,
  props: {
    value: () => string;
    label: string;
    placeholder?: string;
    onChange: (value: string) => void;
    onKey: (event: KeyboardEvent) => boolean;
    onMention: (query: MentionQuery | null) => void;
    /** The document the comment is on: its images are shown through it. Without one, an image shows its alt only. */
    artifactId?: string;
  },
) {
  let value = props.value();
  let plainPaste=false;
  const query = () => {
    const { $from, empty } = view.state.selection;
    const text = $from.parent.textBetween(
      0,
      $from.parentOffset,
      "\n",
      "\ufffc",
    );
    const match =
      empty && !$from.parent.type.spec.code
        ? /(?:^|\s)@([^\s@\[\]]*)$/.exec(text)
        : null;
    props.onMention(
      match
        ? {
            from: $from.pos - match[1].length - 1,
            to: $from.pos,
            query: match[1],
          }
        : null,
    );
  };
  const publish = () => {
    value = commentMarkdown(view.state.doc);
    props.onChange(value);
    query();
  };
  const initialDoc = commentDocument(value);
  const editor = new Editor({
    element: mount,
    // The Markdown codec and mounted editor must share NodeType identities, including
    // slices pasted into the view. Install the same schema before Tiptap builds state/plugins.
    onBeforeCreate: ({ editor }) => {
      editor.extensionManager.schema = commentSchema;
      editor.schema = commentSchema;
    },
    extensions: commentExtensions({ imageAddress: props.artifactId === undefined ? noImageAddress : commentImageAddress(props.artifactId) }),
    content: initialDoc.toJSON(),
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged) publish();
      else query();
    },
    editorProps: {
    attributes: state => ({
      // A trailing editor <br> may sit beside text, so DOM child selectors cannot determine emptiness.
      "data-empty": String(state.doc.childCount === 1 && state.doc.firstChild?.type.name === "paragraph" && state.doc.firstChild.content.size === 0),
      role: "textbox",
      tabindex: "0",
      "aria-placeholder": props.placeholder ?? "",
      "aria-multiline": "true",
      "aria-label": props.label,
      "data-placeholder": props.placeholder ?? "",
      class: "comment-rich-editor",
    }),
    handleDOMEvents:{keydown:(_,event)=>{plainPaste=event.shiftKey;return false;},keyup:()=>{plainPaste=false;return false;}},
    handleKeyDown: (_, event) => props.onKey(event),
    handleClick: (_, __, event) => {
      if ((event.target as Element).closest("a")) return true;
      return false;
    },
    handlePaste(view, event) {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return false;
      if(plainPaste){view.dispatch(view.state.tr.insertText(text));return true;}
      if(event.clipboardData?.getData('text/html')||view.state.selection.$from.parent.type.spec.code)return false;
      const doc = commentDocument(text);
      view.dispatch(
        view.state.tr
          .replaceSelection(new Slice(doc.content, 1, 1))
          .scrollIntoView(),
      );
      return true;
    },
    clipboardTextSerializer: (slice) =>
      slice.content.firstChild?.isInline
        ? inlineMarkdown(slice.content)
        : commentMarkdown(commentSchema.node("doc", null, slice.content)),
    handleTextInput(view, from, to, text) {
      if (view.composing || view.state.selection.$from.parent.type.spec.code)
        return false;
      const $from = view.state.doc.resolve(from),
        before =
          $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc") +
          text;
      // `_` opens only after a non-word character, as in Markdown, so snake_case stays text.
      const match =
        /(\*\*[^*\n]+\*\*|(?<![\p{L}\p{N}_])_[^_\n]+_|(?<!\*)\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))$/u.exec(
          before,
        );
      const nodes = match ? typedInline(match[0]) : null;
      if (match && nodes) {
        const start = from + text.length - match[0].length;
        view.dispatch(
          view.state.tr
            .insertText(text, from, to)
            .replaceWith(start, from + text.length, nodes)
            .setStoredMarks(null),
        );
        return true;
      }
      if (text === ' ' && /^#{1,6} $/.test(before) && $from.parent.type.name === 'paragraph') {
        view.dispatch(view.state.tr.delete($from.start(),from).setBlockType($from.start(), $from.start(), commentSchema.nodes.heading, {level:before.trim().length}));
        return true;
      }
      if (text === " " && /^[-*] $/.test(before)) {
        view.dispatch(view.state.tr.delete($from.start(), from));
        wrapInList(commentSchema.nodes.bulletList)(view.state, view.dispatch);
        return true;
      }
      return false;
    },
  }});
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  return {
    view,
    sync(next: string) {
      if (next === value || view.composing) return;
      value = next;
      const doc = commentDocument(next);
      view.updateState(
        EditorState.create({
          schema: commentSchema,
          doc,
          selection: TextSelection.atEnd(doc),
          plugins: view.state.plugins,
        }),
      );
    },
    format(marker: MdMarker) {
      const command: Command =
        marker === "list"
          ? wrapInList(commentSchema.nodes.bulletList)
          : marker === "link"
            ? toggleMark(commentSchema.marks.link, { href: "https://", title: null })
            : toggleMark(
                commentSchema.marks[
                  marker === "bold"
                    ? "bold"
                    : marker === "italic"
                      ? "italic"
                      : "code"
                ],
              );
      command(view.state, view.dispatch);
      view.focus();
    },
    link(href: string) {
      if (!linkAllowed(href)) return false;
      toggleMark(commentSchema.marks.link, { href, title: null })(
        view.state,
        view.dispatch,
      );
      view.focus();
      return true;
    },
    mention(range: MentionQuery, text: string) {
      const nodes = commentDocument(text).firstChild!.content;
      const tr = view.state.tr.replaceWith(range.from, range.to, nodes);
      tr.setSelection(TextSelection.create(tr.doc, range.from + nodes.size));
      view.dispatch(tr);
      view.focus();
    },
    destroy() {
      editor.destroy();
    },
  };
}
