/** Comment-only ProseMirror boundary. Markdown is the public value; DOM never crosses the wire. */
import {
  Schema,
  type Node as PMNode,
  type Mark,
  Slice,
} from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  baseKeymap,
  toggleMark,
  chainCommands,
  selectAll,
  splitBlockAs,
} from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import {
  wrapInList,
  splitListItem,
  liftListItem,
} from "prosemirror-schema-list";
import {
  parseMarkdownLite,
  parseInline,
  safeHref,
  type MdNode,
  type MdInline,
  type MdMarker,
} from "@/lib/annotations/markdown-lite";
import { isSessionMentionHref } from "@/lib/annotations/session-mentions";
import { isPersonMentionHref } from "@/lib/annotations/person-mentions";
import { agentNameColor } from "../lib/agent-identity";

const commentSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    heading: {content:'inline*',group:'block',defining:true,attrs:{level:{default:2}},parseDOM:[1,2,3,4,5,6].map(level=>({tag:`h${level}`,attrs:{level}})),toDOM:node=>[`h${node.attrs.level}`,0]},
    text: { group: "inline" },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    mention: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { label: {}, href: {} },
      parseDOM: [
        {
          tag: "span[data-comment-mention]",
          getAttrs: (dom) => {
            const href = dom.getAttribute("data-mention-href") ?? "";
            return isSessionMentionHref(href) || isPersonMentionHref(href)
              ? { label: dom.textContent ?? "", href }
              : false;
          },
        },
      ],
      toDOM: (node) => [
        "span",
        {
          "data-comment-mention": "",
          "data-mention-href": node.attrs.href,
          contenteditable: "false",
          style: `--mention-color:${agentNameColor(String(node.attrs.label).replace(/^@/, ""))}`,
        },
        node.attrs.label,
      ],
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      marks: "",
      attrs: { lang: { default: null } },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: () => ["pre", ["code", 0]],
    },
    blockquote: {
      content: "block+",
      group: "block",
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },
    ordered_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ol" }],
      toDOM: () => ["ol", 0],
    },
    list_item: {
      content: "paragraph block*",
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => {
            const href = safeHref(dom.getAttribute("href") ?? "");
            return href ? { href } : false;
          },
        },
      ],
      toDOM: (mark) => [
        "a",
        { href: mark.attrs.href, rel: "noopener noreferrer" },
        0,
      ],
    },
  },
});
function inlines(nodes: MdInline[], marks: Mark[] = []): PMNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "text")
      return node.text ? [commentSchema.text(node.text, marks)] : [];
    if (node.kind === "break") return [commentSchema.node("hard_break")];
    if (node.kind === "code")
      return node.text
        ? [
            commentSchema.text(node.text, [
              ...marks,
              commentSchema.mark("code"),
            ]),
          ]
        : [];
    if (
      node.kind === "link" &&
      (isSessionMentionHref(node.href) || isPersonMentionHref(node.href))
    ) {
      const label = node.children
        .map((child) => (child.kind === "text" ? child.text : ""))
        .join("");
      return [commentSchema.node("mention", { label, href: node.href })];
    }
    return inlines(node.children, [
      ...marks,
      commentSchema.mark(
        node.kind === "strong" ? "strong" : node.kind === "em" ? "em" : "link",
        node.kind === "link" ? { href: node.href } : undefined,
      ),
    ]);
  });
}
function block(node: MdNode): PMNode {
  if (node.kind === 'heading') return commentSchema.node('heading',{level:node.level},inlines(node.children));
  if (node.kind === "paragraph")
    return commentSchema.node("paragraph", null, inlines(node.children));
  if (node.kind === "code_block")
    return commentSchema.node(
      "code_block",
      { lang: node.lang },
      node.text ? commentSchema.text(node.text) : undefined,
    );
  if (node.kind === "quote")
    return commentSchema.node("blockquote", null, node.children.map(block));
  return commentSchema.node(
    node.ordered ? "ordered_list" : "bullet_list",
    null,
    node.items.map((item) =>
      commentSchema.node("list_item", null, item.children.map(block)),
    ),
  );
}
export function commentDocument(markdown: string): PMNode {
  const nodes = parseMarkdownLite(markdown).map(block);
  return commentSchema.node(
    "doc",
    null,
    nodes.length ? nodes : [commentSchema.node("paragraph")],
  );
}
function inlineMarkdown(node: PMNode): string {
  const nodes: PMNode[] = [];
  node.forEach((child) => nodes.push(child));
  const escape = (text: string) =>
    text
      .replace(/[\\`*_\[\]>]/g, "\\$&")
      .replace(/(^|\n)([ \t]*)([-+#])/g, "$1$2\\$3")
      .replace(/(^|\n)([ \t]*)(\d+)\./g, "$1$2$3\\.");
  function render(children: PMNode[], depth: number, inCode = false): string {
    let result = "";
    for (let i = 0; i < children.length;) {
      const child = children[i],
        mark = child.marks[depth];
      if (mark) {
        let end = i + 1;
        while (end < children.length && children[end].marks[depth]?.eq(mark))
          end++;
        const body = render(
          children.slice(i, end),
          depth + 1,
          inCode || mark.type.name === "code",
        );
        if (mark.type.name === "link")
          result += `[${body}](${mark.attrs.href})`;
        else if (mark.type.name === "code") {
          const fence = "`".repeat(
            Math.max(
              0,
              ...Array.from(body.matchAll(/`+/g), (m) => m[0].length),
            ) + 1,
          );
          result += fence + body + fence;
        } else {
          const delimiter = mark.type.name === "strong" ? "**" : "_";
          const leading = /^\s*/.exec(body)![0],
            trailing = /\s*$/.exec(body)![0],
            trimmed = body.trim();
          result += trimmed
            ? leading + delimiter + trimmed + delimiter + trailing
            : body;
        }
        i = end;
      } else {
        result +=
          child.type.name === "mention"
            ? `[${escape(child.attrs.label)}](${child.attrs.href})`
            : child.type.name === "hard_break"
              ? "\n"
              : inCode
                ? (child.text ?? "")
                : escape(child.text ?? "");
        i++;
      }
    }
    return result;
  }
  return render(nodes, 0);
}
export function commentMarkdown(doc: PMNode): string {
  const children: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === "paragraph") children.push(inlineMarkdown(node));
    else if (node.type.name === 'heading') children.push('#'.repeat(node.attrs.level)+' '+inlineMarkdown(node));
    else if (node.type.name === "code_block")
      children.push(
        "```" + (node.attrs.lang ?? "") + "\n" + node.textContent + "\n```",
      );
    else if (node.type.name === "blockquote")
      children.push(
        commentMarkdown(node)
          .split("\n")
          .map((line) => "> " + line)
          .join("\n"),
      );
    else if (
      node.type.name === "bullet_list" ||
      node.type.name === "ordered_list"
    ) {
      const items: string[] = [];
      node.forEach((item, _, index) =>
        items.push(
          (node.type.name === "ordered_list" ? `${index + 1}. ` : "- ") +
            commentMarkdown(item).replace(/\n/g, "\n  "),
        ),
      );
      children.push(items.join("\n"));
    }
  });
  return children.join("\n\n");
}
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
  },
) {
  let value = props.value();
  const undo: EditorState[] = [];
  const redo: EditorState[] = [];
  let lastEdit = 0;
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
  const history = (back: boolean) => () => {
    const source = back ? undo : redo,
      target = back ? redo : undo;
    const state = source.pop();
    if (!state) return false;
    target.push(view.state);
    view.updateState(state);
    lastEdit = 0;
    publish();
    return true;
  };
  const initialDoc = commentDocument(value);
  const view = new EditorView(mount, {
    state: EditorState.create({
      schema: commentSchema,
      doc: initialDoc,
      selection: TextSelection.atEnd(initialDoc),
      plugins: [
        keymap({
          "Mod-z": history(true),
          "Mod-Shift-z": history(false),
          "Ctrl-y": history(false),
          "Ctrl-a": selectAll,
          "Meta-a": selectAll,
          Enter: chainCommands(
            splitListItem(commentSchema.nodes.list_item),
            liftListItem(commentSchema.nodes.list_item),
            splitBlockAs((node, atEnd) => atEnd && node.type.name === 'heading' ? {type:commentSchema.nodes.paragraph} : null),
            baseKeymap.Enter,
          ),
          "Shift-Enter": (state, dispatch) => {
            dispatch?.(
              state.tr.replaceSelectionWith(commentSchema.node("hard_break")),
            );
            return true;
          },
        }),
        keymap(baseKeymap),
      ],
    }),
    attributes: {
      role: "textbox",
      tabindex: "0",
      "aria-placeholder": props.placeholder ?? "",
      "aria-multiline": "true",
      "aria-label": props.label,
      "data-placeholder": props.placeholder ?? "",
      class: "comment-rich-editor",
    },
    dispatchTransaction(tr) {
      if (tr.docChanged) {
        const now = Date.now();
        if (now - lastEdit > 500 || !tr.getMeta("uiEvent")) {
          undo.push(view.state);
          if (undo.length > 100) undo.shift();
        }
        redo.length = 0;
        lastEdit = now;
      }
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) publish();
      else query();
    },
    handleKeyDown: (_, event) => props.onKey(event),
    handleClick: (_, __, event) => {
      if ((event.target as Element).closest("a")) return true;
      return false;
    },
    handlePaste(view, event) {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return false;
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
        ? inlineMarkdown(commentSchema.node("paragraph", null, slice.content))
        : commentMarkdown(commentSchema.node("doc", null, slice.content)),
    handleTextInput(view, from, to, text) {
      if (view.composing || view.state.selection.$from.parent.type.spec.code)
        return false;
      const $from = view.state.doc.resolve(from),
        before =
          $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc") +
          text;
      const match =
        /(\*\*[^*\n]+\*\*|_[^_\n]+_|(?<!\*)\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\))$/.exec(
          before,
        );
      if (match) {
        const nodes = inlines(parseInline(match[0]));
        if (
          nodes.some(
            (node) => node.marks.length || node.type.name === "mention",
          )
        ) {
          const start = from + text.length - match[0].length;
          view.dispatch(
            view.state.tr
              .insertText(text, from, to)
              .replaceWith(start, from + text.length, nodes)
              .setStoredMarks(null),
          );
          return true;
        }
      }
      if (text === ' ' && /^#{1,6} $/.test(before) && $from.parent.type.name === 'paragraph') {
        view.dispatch(view.state.tr.delete($from.start(),from).setBlockType($from.start(), $from.start(), commentSchema.nodes.heading, {level:before.trim().length}));
        return true;
      }
      if (text === " " && /^[-*] $/.test(before)) {
        view.dispatch(view.state.tr.delete($from.start(), from));
        wrapInList(commentSchema.nodes.bullet_list)(view.state, view.dispatch);
        return true;
      }
      return false;
    },
  });
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
      undo.length = redo.length = 0;
    },
    format(marker: MdMarker) {
      const command: Command =
        marker === "list"
          ? wrapInList(commentSchema.nodes.bullet_list)
          : marker === "link"
            ? toggleMark(commentSchema.marks.link, { href: "https://" })
            : toggleMark(
                commentSchema.marks[
                  marker === "bold"
                    ? "strong"
                    : marker === "italic"
                      ? "em"
                      : "code"
                ],
              );
      command(view.state, view.dispatch);
      view.focus();
    },
    link(href: string) {
      const safe = safeHref(href);
      if (!safe) return false;
      toggleMark(commentSchema.marks.link, { href: safe })(
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
      view.destroy();
    },
  };
}
