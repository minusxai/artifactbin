import { COMMENT_ACTIONS_CSS } from "../frame-edit/comment-actions-presentation";
import type { StoryEditSelection } from "../edit-protocol";

/** Native reader chrome only offers actions explicitly granted by the parent. */
export interface HtmlSelectionActions {
  update(enabled: boolean): void;
  ownsOverlay(node: Node): boolean;
  dispose(): void;
}
export interface HtmlSelectionActionsOptions {
  win: Window;
  capture(target?: Node): StoryEditSelection | null;
  onAction(action: "annotate" | "select", selection: StoryEditSelection): void;
}
export function createHtmlSelectionActions({
  win,
  capture,
  onAction,
}: HtmlSelectionActionsOptions): HtmlSelectionActions {
  const doc = win.document;
  const style = doc.createElement("style");
  style.textContent = COMMENT_ACTIONS_CSS;
  const toolbar = doc.createElement("div");
  toolbar.setAttribute("data-mx-selection-actions", "");
  toolbar.setAttribute("role", "toolbar");
  toolbar.hidden = true;
  doc.head.append(style);
  doc.body.append(toolbar);
  let enabled = false,
    held = false,
    context = false,
    active: StoryEditSelection | null = null,
    settle = 0;
  const ownsOverlay = (node: Node) => node === style || toolbar.contains(node);
  const hide = () => {
    win.clearTimeout(settle);
    context = false;
    active = null;
    toolbar.hidden = true;
  };
  const editable = (node: Node | null) => {
    const element =
      node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    return !!element?.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
    );
  };
  const coarse = () => win.matchMedia?.("(pointer: coarse)").matches === true;
  const show = (selected: StoryEditSelection, x?: number, y?: number) => {
    active = selected;
    toolbar.replaceChildren();
    toolbar.setAttribute(
      "aria-label",
      context ? "Document actions" : "Text selection actions",
    );
    for (const action of ["annotate", "select"] as const) {
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("data-mx-selection-action", action);
      button.textContent = action === "annotate" ? "Comment" : "Select";
      button.setAttribute(
        "aria-label",
        action === "annotate" && !context
          ? "Comment on selected text"
          : button.textContent,
      );
      if (coarse()) button.classList.add("mx-selection-action--coarse");
      toolbar.append(button);
    }
    toolbar.hidden = false;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(x ?? selected.rect.x + selected.rect.width / 2, win.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(y ?? selected.rect.y - rect.height - 8, win.innerHeight - rect.height - 8))}px`;
    toolbar.style.transform = "none";
  };
  const selection = (target?: Node) => {
    if (context || held) return;
    const native = win.getSelection();
    if (
      !enabled ||
      !native?.toString().trim() ||
      editable(native.anchorNode) ||
      editable(native.focusNode)
    ) {
      hide();
      return;
    }
    const selected = capture(target);
    if (selected) show(selected);
    else hide();
  };
  const changed = () => {
    if (context) return;
    win.clearTimeout(settle);
    if (coarse()) settle = win.setTimeout(selection, 200);
    else selection();
  };
  const down = (event: PointerEvent) => {
    if (ownsOverlay(event.target as Node)) return;
    hide();
    held = event.button === 0;
  };
  const release = (event: Event) => {
    if (event.type.startsWith("pointer") && ownsOverlay(event.target as Node))
      return;
    held = false;
    changed();
  };
  const menu = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (
      event.defaultPrevented ||
      !enabled ||
      event.shiftKey ||
      !target?.closest ||
      editable(target) ||
      target.closest("a") ||
      ownsOverlay(target)
    )
      return;
    hide();
    if (win.getSelection()?.toString().trim()) {
      selection(target);
      if (active) event.preventDefault();
      return;
    }
    const selected = capture(target);
    if (!selected) return;
    event.preventDefault();
    context = true;
    show(selected, event.clientX, event.clientY + 7);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !toolbar.hidden) {
      hide();
      win.getSelection()?.removeAllRanges();
    }
  };
  const blur = () => {
    held = false;
    hide();
  };
  const keyUp = (event: KeyboardEvent) => {
    if (
      event.key === "Shift" ||
      /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(
        event.key,
      ) ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")
    )
      changed();
  };
  const reposition = () => {
    if (context) hide();
    else if (active) selection();
  };
  const choose = (event: MouseEvent) => {
    const action = (event.target as Element)
      ?.closest("[data-mx-selection-action]")
      ?.getAttribute("data-mx-selection-action");
    if (!active || (action !== "annotate" && action !== "select")) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = active;
    hide();
    if (action === "select") win.getSelection()?.removeAllRanges();
    onAction(action, selected);
  };
  const preserve = (event: PointerEvent) => event.preventDefault();
  toolbar.addEventListener("pointerdown", preserve);
  toolbar.addEventListener("click", choose);
  doc.addEventListener("selectionchange", changed);
  doc.addEventListener("pointerdown", down);
  doc.addEventListener("pointerup", release);
  doc.addEventListener("pointercancel", release);
  doc.addEventListener("contextmenu", menu);
  doc.addEventListener("keydown", key);
  doc.addEventListener("keyup", keyUp);
  win.addEventListener("blur", blur);
  win.addEventListener("scroll", reposition, true);
  win.addEventListener("resize", reposition);
  win.visualViewport?.addEventListener("resize", reposition);
  win.visualViewport?.addEventListener("scroll", reposition);
  return {
    ownsOverlay,
    update(value) {
      const granted = value && !enabled;
      enabled = value;
      if (!enabled) hide();
      else if (granted) changed();
    },
    dispose() {
      hide();
      toolbar.remove();
      style.remove();
      doc.removeEventListener("selectionchange", changed);
      doc.removeEventListener("pointerdown", down);
      doc.removeEventListener("pointerup", release);
      doc.removeEventListener("pointercancel", release);
      doc.removeEventListener("contextmenu", menu);
      doc.removeEventListener("keydown", key);
      doc.removeEventListener("keyup", keyUp);
      win.removeEventListener("blur", blur);
      win.removeEventListener("scroll", reposition, true);
      win.removeEventListener("resize", reposition);
      win.visualViewport?.removeEventListener("resize", reposition);
      win.visualViewport?.removeEventListener("scroll", reposition);
    },
  };
}
