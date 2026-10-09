/**
 * THE TOOLBAR'S FORMAT AND LINK, APPLIED INSIDE THE DOCUMENT.
 *
 * Part of the edit session (lib/story-runtime/edit/session). Only this document holds the live
 * Selection and the ProseMirror views, so the page asks and this applies: a class or style on the
 * block at `path`, or a link around the selected words. Inside a prose flow the change is a
 * ProseMirror transaction (the flow reports it as an ordinary edit); on a plain text host the
 * host's new HTML goes back through the text-edit channel.
 */
import type { JsxElement } from '@/lib/jsx';
import { setLink } from '@/lib/editor-v2/links';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { RuntimeChannel } from '../pristine';
import { STORY_TEXT_EDIT_MESSAGE } from '../contract';
import type { EditViews } from './hover-select';

export interface FormatLinkOptions {
  win: Window;
  root: HTMLElement;
  views: EditViews;
  channel: Pick<RuntimeChannel, 'innerHtmlOf'>;
  post: (message: Record<string, unknown>) => void;
  /** Re-send the selection: a format changes what the toolbar shows for it. */
  republishRect: () => void;
}

export interface FormatLink {
  /** Set (or with an empty string, remove) the class and/or style of the block at `path`. */
  applyFormat(path: string, className?: string, style?: string): void;
  /** Wrap the live text selection inside the host at `path` in a link, or unwrap it (`href` null). */
  applyLink(path: string, href: string | null): void;
}

export function createFormatLink({ win, root, views, channel, post, republishRect }: FormatLinkOptions): FormatLink {
  const doc = win.document;
  const at = (path: string) => root.querySelector<HTMLElement>(`[${AST_PATH_ATTR}="${CSS.escape(path)}"]`);

  const applyFormat = (path: string, className?: string, style?: string) => {
    const el = at(path);
    if (!el) return;
    const editor = [...views.all].find((view) => view.dom.contains(el));
    if (editor && className !== undefined) {
      let position: number | null = null;
      editor.state.doc.descendants((_node, pos) => {
        if (editor.nodeDOM(pos) === el) position = pos;
      });
      if (position !== null) {
        const node = editor.state.doc.nodeAt(position)!;
        const original = node.attrs.source as JsxElement | null;
        const attributes = (original?.attributes ?? []).filter((a) => !['class', 'className'].includes(a.name));
        if (className)
          attributes.push({ name: 'className', value: { static: true, json: className }, start: 0, end: 0 });
        editor.dispatch(
          editor.state.tr
            .setNodeMarkup(position, undefined, { ...node.attrs, source: { ...original, attributes } })
            .setMeta('mx-command', true),
        );
        republishRect();
        return;
      }
    }
    if (className !== undefined) {
      if (el.hasAttribute('data-mx-markdown')) className = `mx-markdown ${className}`;
      if (className.trim()) el.setAttribute('class', className);
      else el.removeAttribute('class');
    }
    if (style !== undefined) {
      if (style.trim()) el.setAttribute('style', style);
      else el.removeAttribute('style');
    }
    republishRect();
  };

  const applyLink = (path: string, href: string | null) => {
    const view = views.last;
    if (view && views.all.has(view)) {
      const tr = setLink(view.state, href);
      if (!tr) return;
      view.dispatch(tr.setMeta('mx-command', true));
      view.focus();
      return;
    }
    const host = at(path);
    if (!host) return;
    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return;
    if (href) {
      /*
       * VALIDATED HERE, not only where it was typed.
       *
       * The page asks for this link, and the page is trusted — but a URL that
       * becomes an `href` is executable if its scheme says so, and "somebody
       * upstream checked" is not a property this document can verify. The door
       * that rejects active-content schemes is pure and costs nothing, so it
       * runs on both sides. (The write-back sanitizes again before anything is
       * stored; this is about what the LIVE document carries in between.)
       */
      const safe = normalizeLinkHref(href);
      if (!safe) return;
      // Restated at the sink against literal prefixes. `normalizeLinkHref` is
      // the door and it is tested; this line is what a reader (and a scanner)
      // can check WITHOUT leaving the function that writes the attribute.
      if (!(
        safe.startsWith('https://') ||
        safe.startsWith('http://') ||
        safe.startsWith('mailto:') ||
        safe.startsWith('tel:') ||
        safe.startsWith('/') ||
        safe.startsWith('#')
      ))
        return;
      const anchor = doc.createElement('a');
      anchor.setAttribute('href', safe);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      try {
        range.surroundContents(anchor);
      } catch {
        return;
      } // a partial selection across elements
    } else {
      const anchor =
        (range.commonAncestorContainer as Element).parentElement?.closest?.('a') ??
        (range.commonAncestorContainer as Element).closest?.('a');
      if (!anchor) return;
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
    post({ type: STORY_TEXT_EDIT_MESSAGE, path, innerHtml: channel.innerHtmlOf(host) });
  };

  return { applyFormat, applyLink };
}
