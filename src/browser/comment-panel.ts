import type { Comment } from "../contracts.ts";
import type {
  CommentPanel,
  CommentPanelOptions,
  CommentSelection,
} from "./comment-panel-contracts.ts";
import { createCommentAttachmentGallery } from "./comment-attachment-gallery.ts";
import { CommentComposer } from "./comment-composer.ts";
import {
  commentTransition,
  commentHighlights,
  markedThreads,
  railLayout,
} from "../chrome-model.ts";
import { avatar, icon } from "./identity.js";
/** Annotation presentation owns drafts, selection, hover and focus. It cannot mutate document state. */
export function createCommentPanel(options: CommentPanelOptions): CommentPanel {
  const { layer, read: data, geometry } = options;
  const document = layer.ownerDocument;
  const composer = new CommentComposer();
  let disposed = false;
  let attachmentGalleries: { dispose(): void }[] = [];
  function clearAttachments() {
    for (const gallery of attachmentGalleries) gallery.dispose();
    attachmentGalleries = [];
  }
  function attachments(entry: Comment, parent: HTMLElement) {
    if (entry.attachments?.length && options.attachmentResources)
      attachmentGalleries.push(
        createCommentAttachmentGallery({
          parent,
          commentId: entry.id,
          attachments: entry.attachments,
          resources: options.attachmentResources,
        }),
      );
  }
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissedHover: string | null = null;
  let dismissedPointer: { x: number; y: number } | null = null;
  /** The list of resolved threads is open. */
  let showResolved = false;
  const canComment = () => data().canComment;
  const commentNotice = () => data().notice;
  const rectFor = (id: string | null | undefined) =>
    geometry().targets.find((t) => t.id === id)?.rect;
  function position(el: HTMLElement, id: string | null | undefined) {
    const r = rectFor(id),
      { inset, height } = geometry();
    el.style.right = "12px";
    el.style.top =
      Math.max(
        inset + 8,
        Math.min(
          height - Math.min(el.scrollHeight, height * 0.7) - 12,
          inset + (r?.y || 0) + 12,
        ),
      ) + "px";
  }
  function button(
    label: string,
    action: () => unknown,
    parent: HTMLElement,
    cls = "",
  ) {
    const el = document.createElement("button");
    el.textContent = label;
    el.className = cls;
    el.onclick = () => {
      Promise.resolve()
        .then(action)
        .catch((e) => options.actions.error(e.message));
    };
    parent.append(el);
    return el;
  }
  function para(text: string, parent: HTMLElement, cls = "") {
    const el = document.createElement("p");
    el.textContent = text;
    el.className = cls;
    parent.append(el);
    return el;
  }
  function addComment(
    body: string,
    selection: CommentSelection,
    parentId: string | null = null,
  ) {
    if (!canComment()) return options.actions.error(commentNotice());
    if (!body.trim()) return;
    const id = options.actions.post(body, selection, parentId);
    composer.sent(id, selection, data().sourceRevision, parentId);
    options.actions.finishSelection();
    draw();
  }
  function draftKey(pick: CommentSelection) {
    return composer.key(pick, data().sourceRevision);
  }

  function closeComment() {
    dismissedHover = composer.interaction.active;
    // Only a composer that was open ends "Add comment" mode: a dismissal with
    // nothing composed (the pointerdown before a pick) must leave it on.
    const composing = composer.selection !== null;
    composer.selection = null;
    showResolved = false;
    composer.interaction = commentTransition(composer.interaction, {
      kind: "close",
    });
    if (composing) options.actions.finishSelection();
    draw();
  }
  function leaveComment() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      composer.interaction = commentTransition(composer.interaction, {
        kind: "leave",
      });
      draw();
    }, 180);
  }
  function authorHeader(
    entry: Pick<Comment, "publishedBy"> & Partial<Pick<Comment, "createdAt">>,
    parent: HTMLElement,
  ) {
    const row = document.createElement("div");
    row.className = "pg-comment-author";
    const face = document.createElement("span");
    face.className = "pg-person";
    avatar(
      face,
      data().profiles[entry.publishedBy || ""],
      entry.publishedBy || data().actor || "You",
    );
    const name = document.createElement("strong");
    name.textContent =
      data().profiles[entry.publishedBy || ""]?.name ||
      entry.publishedBy ||
      "You";
    row.append(face, name);
    if (entry.createdAt) {
      const time = document.createElement("time");
      const date = new Date(entry.createdAt);
      time.textContent =
        date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " +
        date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
      time.dateTime = date.toISOString();
      row.append(time);
    }
    parent.append(row);
  }
  function drawCommentTargets(roots: Comment[], active: string | null) {
    let paint = layer.querySelector<HTMLElement>(".pg-targets");
    if (!paint) {
      paint = document.createElement("div");
      paint.className = "pg-targets";
      paint.setAttribute("aria-hidden", "true");
      layer.prepend(paint);
    }
    paint.replaceChildren();
    paint.style.top = geometry().inset + "px";
    for (const target of commentHighlights(
      roots.filter((c): c is Comment & { nodeId: string } => c.nodeId !== null),
      geometry().targets,
      active,
    )) {
      const mark = document.createElement("div");
      mark.className = "pg-target";
      mark.dataset.nodeId = target.nodeId;
      mark.dataset.emphasis = target.emphasis;
      Object.assign(mark.style, {
        left: target.rect.x + "px",
        top: target.rect.y + "px",
        width: target.rect.width + "px",
        height: target.rect.height + "px",
      });
      paint.append(mark);
    }
  }
  function positionRail(roots: Comment[]) {
    const positions = railLayout(
      roots.map((c) => ({
        id: c.id,
        top: Math.min(
          geometry().height - geometry().inset - 48,
          Math.max(12, rectFor(c.nodeId)?.y || 12),
        ),
      })),
      12,
    );
    for (const item of positions) {
      const pin = [...layer.querySelectorAll<HTMLElement>(".pg-pin")].find(
        (el) => el.dataset.commentId === item.id,
      );
      if (pin) pin.style.top = item.top + "px";
    }
  }
  function draw() {
    if (disposed) return;

    const focused = layer.querySelector("textarea") === document.activeElement;
    const caret = focused
      ? (document.activeElement as HTMLTextAreaElement).selectionStart
      : null;
    const roots = data().comments.filter((c) => !c.parentId && !c.resolved);
    const marked = markedThreads(roots, geometry().targets, data().live);
    const resolved = data().comments.filter((c) => !c.parentId && c.resolved);
    const c = data().comments.find((c) => c.id === composer.interaction.active);
    const key = JSON.stringify({
      selected: composer.selection,
      attachmentRevision: options.attachmentResources?.revision,
      permissions: [
        data().canComment,
        data().canResolve,
        data().actor,
        data().notice,
      ],
      active: composer.interaction.active,
      pinned: composer.interaction.pinned,
      expanded: composer.interaction.expanded,
      comments: data().comments,
      profiles: data().profiles,
      marked: marked.map((thread) => thread.id),
      showResolved,
    });
    drawCommentTargets(roots, composer.selection?.nodeId || c?.nodeId || null);
    const existing = layer.querySelector<HTMLElement>(".pg-bubble");
    if (existing && layer.dataset.key === key) {
      positionRail(marked);
      position(existing, composer.selection?.nodeId || c?.nodeId);
      return;
    }
    layer.dataset.key = key;
    clearAttachments();
    layer.replaceChildren();
    drawCommentTargets(roots, composer.selection?.nodeId || c?.nodeId || null);
    const rail = document.createElement("div");
    rail.className = "pg-rail";
    rail.style.top = geometry().inset + "px";
    if (marked.length) layer.append(rail);
    if (resolved.length) {
      const toggle = button(
        `Resolved (${resolved.length})`,
        () => {
          showResolved = !showResolved;
          if (showResolved) {
            composer.selection = null;
            composer.interaction = commentTransition(composer.interaction, {
              kind: "close",
            });
          }
          draw();
        },
        layer,
        "pg-resolved-toggle",
      );
      toggle.setAttribute("aria-expanded", String(showResolved));
    }
    const positions = railLayout(
      marked.map((c) => ({
        id: c.id,
        top: Math.min(
          geometry().height - geometry().inset - 48,
          Math.max(12, rectFor(c.nodeId)?.y || 12),
        ),
      })),
      12,
    );
    for (const item of positions) {
      const entry = roots.find((c) => c.id === item.id)!;
      const b = button(
        "",
        () => {
          composer.interaction = commentTransition(composer.interaction, {
            kind: "open",
            id: entry.id,
          });
          composer.selection = null;
          draw();
        },
        rail,
        "pg-pin",
      );
      avatar(
        b,
        data().profiles[entry.publishedBy || ""],
        entry.publishedBy || data().actor || "?",
      );
      b.dataset.commentId = entry.id;
      b.setAttribute("aria-label", "Open comment: " + entry.body);
      b.style.top = item.top + "px";
      b.style.opacity = composer.interaction.active === entry.id ? "0" : "1";
      b.style.pointerEvents =
        composer.interaction.active === entry.id && composer.interaction.pinned
          ? "none"
          : "auto";
      b.style.zIndex =
        composer.interaction.active === entry.id && composer.interaction.pinned
          ? "1"
          : "3";
      const peek = () => {
        if (composer.selection) return;
        clearTimeout(hoverTimer);
        const next = commentTransition(composer.interaction, {
          kind: "hover",
          id: entry.id,
        });
        if (next.active === composer.interaction.active) return;
        composer.interaction = next;
        draw();
      };
      b.onpointerenter = (e) => {
        // Closing a card can expose its marker directly under the stationary mouse.
        if (
          e.pointerType === "mouse" &&
          (dismissedHover !== entry.id ||
            (dismissedPointer &&
              (e.clientX !== dismissedPointer.x ||
                e.clientY !== dismissedPointer.y)))
        ) {
          dismissedHover = null;
          peek();
        }
      };
      b.onpointermove = (e) => {
        if (
          dismissedHover === entry.id &&
          dismissedPointer &&
          (e.clientX !== dismissedPointer.x || e.clientY !== dismissedPointer.y)
        ) {
          dismissedHover = null;
          peek();
        }
      };
      b.onfocus = () => {
        if (b.matches(":focus-visible")) {
          dismissedHover = null;
          peek();
        }
      };
      b.onpointerleave = () => {
        if (b.isConnected) dismissedHover = null;
        leaveComment();
      };
      const replies = data().comments.filter(
        (x) => x.parentId === entry.id,
      ).length;
      if (replies) {
        const count = document.createElement("span");
        count.className = "pg-count";
        count.textContent = replies > 8 ? "9+" : String(replies + 1);
        b.dataset.count = replies > 8 ? "many" : "some";
        b.append(count);
      }
    }
    if (showResolved && resolved.length && !composer.selection && !c) {
      const list = document.createElement("section");
      list.className = "pg-bubble";
      list.dataset.expanded = "true";
      list.setAttribute("role", "dialog");
      list.setAttribute("aria-label", "Resolved comments");
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = "Resolved comments";
      header.append(title);
      const close = button(
        "",
        () => {
          showResolved = false;
          draw();
        },
        header,
        "pg-close",
      );
      close.append(icon("close")!);
      close.setAttribute("aria-label", "Close resolved comments");
      list.append(header);
      for (const entry of resolved) {
        const message = document.createElement("article");
        message.className = "pg-message";
        authorHeader(entry, message);
        if (entry.quote) para(entry.quote.slice(0, 160), message, "pg-quote");
        para(entry.body, message);
        attachments(entry, message);
        const actions = document.createElement("div");
        actions.className = "pg-actions";
        if (
          canComment() &&
          entry.publishedBy &&
          data().canResolve &&
          entry.publishedBy === data().actor
        ) {
          const reopen = button(
            "Reopen",
            async () => {
              await options.actions.reopen(entry);
              showResolved = false;
              draw();
            },
            actions,
          );
          reopen.setAttribute("aria-label", "Reopen comment: " + entry.body);
        }
        message.append(actions);
        list.append(message);
      }
      layer.append(list);
      position(list, null);
      return;
    }
    if (!composer.selection && !c) return;
    const bubble = document.createElement("section");
    bubble.className = "pg-bubble";
    bubble.dataset.expanded = String(
      Boolean(composer.selection || composer.interaction.expanded),
    );
    bubble.setAttribute("role", "dialog");
    bubble.setAttribute(
      "aria-label",
      composer.selection ? "New comment" : "Comment thread",
    );
    bubble.onpointerenter = () => clearTimeout(hoverTimer);
    bubble.onpointerleave = leaveComment;
    bubble.addEventListener("focusin", () => {
      composer.interaction.pinned = true;
    });
    const header = document.createElement("header");
    authorHeader(
      composer.selection ? { publishedBy: data().actor } : c!,
      header,
    );
    const close = button("", closeComment, header);
    close.onpointerdown = (e) => {
      dismissedPointer = { x: e.clientX, y: e.clientY };
    };
    close.append(icon("close")!);
    close.setAttribute("aria-label", "Close comment");
    close.className = "pg-close";
    close.hidden = !composer.selection && !composer.interaction.pinned;
    bubble.append(header);
    if (composer.selection) {
      const pick = composer.selection;
      if (pick.quote) para(pick.quote.slice(0, 160), bubble, "pg-quote");
      else if (pick.nodeId === null) para("Whole page", bubble, "pg-quote");
      const t = document.createElement("textarea");
      t.setAttribute("aria-label", "Comment text");
      t.placeholder = "Leave a comment…";
      t.value = composer.interaction.drafts[draftKey(pick)] || "";
      bubble.append(t);
      const sendRow = document.createElement("div");
      sendRow.className = "pg-send-row";
      para("⌘ / Ctrl ↵", sendRow, "pg-shortcut");
      bubble.append(sendRow);
      const send = button(
        "Post comment",
        () => addComment(t.value, pick),
        sendRow,
        "primary",
      );
      send.disabled = !canComment() || !t.value.trim();
      t.oninput = () => {
        composer.interaction.drafts[draftKey(pick)] = t.value;
        send.disabled = !canComment() || !t.value.trim();
      };
      t.onkeydown = (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (!send.disabled) send.click();
        }
      };
    } else if (c) {
      const replies = data().comments.filter((x) => x.parentId === c.id);
      const showMessage = (
        entry: Comment,
        parent: HTMLElement,
        root = false,
      ) => {
        const message = document.createElement("article");
        message.className = "pg-message";
        if (!root) authorHeader(entry, message);
        para(entry.body, message);
        attachments(entry, message);
        message.dataset.author = entry.publishedBy || "";
        message.dataset.sync = entry.publishedBy ? "saved" : "local";
        if (!entry.publishedBy)
          para("Only in this file until synced", message, "pg-comment-sync");
        parent.append(message);
      };
      showMessage(c, bubble, true);
      const actions = document.createElement("div");
      actions.className = "pg-actions";
      const continuation = document.createElement("span");
      continuation.className = "pg-continuation";
      const expand = (focus = false) => {
        composer.interaction = commentTransition(composer.interaction, {
          kind: "expand",
          id: c.id,
        });
        draw();
        if (focus) layer.querySelector("textarea")?.focus();
      };
      if (replies.length) {
        const stack = document.createElement("span");
        stack.className = "pg-participants";
        const seen = new Set();
        for (const reply of replies) {
          if (seen.has(reply.publishedBy) || seen.size === 3) continue;
          seen.add(reply.publishedBy);
          const face = document.createElement("span");
          avatar(
            face,
            data().profiles[reply.publishedBy || ""],
            reply.publishedBy || data().actor || "You",
          );
          stack.append(face);
        }
        continuation.append(stack);
        if (composer.interaction.expanded) {
          const count = document.createElement("span");
          count.textContent = `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`;
          continuation.append(count);
        } else {
          const more = button(
            `+${replies.length} more`,
            () => expand(),
            continuation,
          );
          more.setAttribute("aria-label", "Expand replies");
          more.setAttribute("aria-expanded", "false");
        }
      } else continuation.textContent = "1 message";
      actions.append(continuation);
      if (!composer.interaction.expanded) {
        const reply = button("Reply", () => expand(true), actions);
        reply.prepend(icon("reply")!);
      }
      if(c.stateReplay?.status === "unavailable") para("Saved interactive state unavailable", actions, "pg-caption");
      if (c.context?.status === "unavailable")
        para("Original context unavailable", actions, "pg-caption");
      else button("View context", () => options.actions.view(c), actions);
      if (
        canComment() &&
        c.publishedBy &&
        data().canResolve &&
        c.publishedBy === data().actor
      ) {
        const resolve = button(
          "Resolve",
          async () => {
            await options.actions.resolve(c);
            composer.interaction = commentTransition(composer.interaction, {
              kind: "close",
            });
            draw();
          },
          header,
          "pg-resolve",
        );
        header.insertBefore(resolve, close);
        resolve.prepend(icon("check")!);
      }
      bubble.append(actions);
      if (composer.interaction.expanded) {
        if (replies.length) {
          const list = document.createElement("div");
          list.className = "pg-replies";
          list.setAttribute("aria-label", "Thread replies");
          for (const entry of replies) showMessage(entry, list);
          bubble.append(list);
        }
        if (c.context?.status !== "unavailable" && !rectFor(c.nodeId))
          para(
            "Target is unavailable in this view. Open the saved context.",
            bubble,
            "pg-caption",
          );
        const box = document.createElement("div");
        box.className = "pg-reply";
        const t = document.createElement("textarea");
        t.setAttribute("aria-label", "Reply to comment");
        t.placeholder = canComment() ? "Reply…" : commentNotice();
        t.disabled = !canComment();
        t.rows = 2;
        t.value = composer.interaction.drafts[c.id] || "";
        box.append(t);
        const sendRow = document.createElement("div");
        sendRow.className = "pg-send-row";
        para("⌘ / Ctrl ↵", sendRow, "pg-shortcut");
        const send = button(
          "Reply",
          () => {
            addComment(
              t.value,
              { nodeId: c.nodeId, quote: c.quote, snapshot: data().snapshot },
              c.id,
            );
            layer.querySelector("textarea")?.focus();
          },
          sendRow,
          "primary",
        );
        send.disabled = !canComment() || !t.value.trim();
        t.oninput = () => {
          composer.interaction = commentTransition(composer.interaction, {
            kind: "draft",
            id: c.id,
            body: t.value,
          });
          send.disabled = !canComment() || !t.value.trim();
        };
        t.onkeydown = (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!send.disabled) send.click();
          }
        };
        box.append(sendRow);
        bubble.append(box);
      }
    }
    layer.append(bubble);
    position(bubble, composer.selection?.nodeId || c?.nodeId);
    if (focused) {
      const t = bubble.querySelector("textarea");
      t?.focus();
      if (t && caret !== null) t.setSelectionRange(caret, caret);
    }
  }
  return {
    get drafts() {
      return composer.interaction.drafts;
    },
    get active() {
      return Boolean(composer.selection || composer.interaction.active);
    },
    open(selection) {
      if (disposed) return;
      if (!canComment()) return options.actions.error(commentNotice());
      composer.open(selection);
      showResolved = false;
      clearAttachments();
      layer.replaceChildren();
      draw();
      layer.querySelector("textarea")?.focus();
    },
    close: closeComment,
    render: draw,
    rename(from, to) {
      composer.rename(from, to);
      if (dismissedHover === from) dismissedHover = to;
    },
    dismissOutside(target) {
      if (
        !layer.contains(target) &&
        !layer.querySelector("textarea")?.value.trim() &&
        (composer.selection || composer.interaction.active || showResolved)
      )
        closeComment();
    },
    dispose() {
      disposed = true;
      clearTimeout(hoverTimer);
      clearAttachments();
      layer.replaceChildren();
    },
  };
}
