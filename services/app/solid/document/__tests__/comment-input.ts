import { beforeAll, afterAll } from "vitest";
import { fireEvent } from "../../__tests__/helpers";
/** Exercise the editor's real keyboard/paste boundary instead of textarea-only value setters. */
export function replaceComment(field: HTMLElement, text: string) {
  field.focus();
  fireEvent.keyDown(field, { key: "a", ctrlKey: true });
  fireEvent.paste(field, {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      files: [],
      types: ["text/plain"],
    },
  });
}
export async function selectCommentText(
  field: HTMLElement,
  start: number,
  end: number,
) {
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  const points: { node: Node; start: number; end: number }[] = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    points.push({
      node,
      start: offset,
      end: offset + (node.textContent?.length ?? 0),
    });
    offset += node.textContent?.length ?? 0;
  }
  const first = points.find((p) => p.end >= start)!,
    last = points.find((p) => p.end >= end)!;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  field.focus();
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

// JSDOM has no layout; ProseMirror measures the caret after paste and keyboard edits.
const exec = Object.getOwnPropertyDescriptor(document, "execCommand");
const rects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
);
const rect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
beforeAll(() => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterAll(() => {
  if (exec) Object.defineProperty(document, "execCommand", exec);
  else Reflect.deleteProperty(document, "execCommand");
  if (rects) Object.defineProperty(Range.prototype, "getClientRects", rects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (rect)
    Object.defineProperty(Range.prototype, "getBoundingClientRect", rect);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
