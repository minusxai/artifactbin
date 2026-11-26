/**
 * Versioned native tree schema. Browser and server use precisely the same supported nodes.
 *
 * The image node (`img src alt [title]`, inline, an atom with its own `data-af-id`): the codec (native-html.ts) reads
 * and writes it, validation (native-state.ts) checks it, Markdown (native-markdown.ts) and HTML revisions write it, and
 * the editor shows it, builds it from a pasted or dropped `<img>` and inserts one by address (native-region-editor's
 * `image` command). Every writer takes only the sources lib/markdown's imageAllowed allows (https, relative, an upload
 * `ref:<id>`); a pasted image with any other source, a `data:` one included, is dropped. The editor shows an image at
 * the address the served page gave it, so a copy carries its stored source beside that one (`data-af-src`), which the
 * paste rule prefers. An image carries no marks: the collaboration binding stores only a node's attributes.
 */
import { Extension, getSchema, Node as TiptapNode, type Mark, type Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts/artifact-reference';
import { imageAllowed } from '../markdown/href';
import { safeHref } from './href';
export const NATIVE_ROOT = 'native-v1';
/** The longest image title a document stores (native-html.ts and native-state.ts refuse a longer one). */
export const IMAGE_TITLE_MAX = 512;
const Identity = Extension.create({
  name: 'regionIdentity',
  addGlobalAttributes: () => [{
    types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'image', 'bold', 'italic', 'code', 'link'],
    attributes: { afId: { default: null, parseHTML: element => element.getAttribute('data-af-id'), renderHTML: attrs => attrs.afId ? { 'data-af-id': attrs.afId } : {} } },
  }, { types: ['codeBlock'], attributes: { codeAfId: { default: null, parseHTML: element => element.querySelector('code')?.getAttribute('data-af-id') ?? null, renderHTML: () => ({}) } } }],
});
// Legacy checkboxes remain ordinary list items: changing their list/node kind would
// normalize mixed lists and invalidate the migration's exact DOM manifest. Null
// preserves absence (in particular aria-disabled versus aria-disabled="false").
const checkboxValue = (value: unknown) => {
  if (value !== null && value !== 'true' && value !== 'false') throw new RangeError('legacy checkbox value');
};
const LegacyCheckbox = Extension.create({
  name: 'legacyCheckbox',
  addGlobalAttributes: () => [{ types: ['listItem'], attributes: {
    legacyChecked: { default: null, validate: checkboxValue,
      parseHTML: element => element.getAttribute('role') === 'checkbox' && ['true','false'].includes(element.getAttribute('aria-checked') ?? '') ? element.getAttribute('aria-checked') : null,
      renderHTML: attrs => attrs.legacyChecked === null ? {} : { role: 'checkbox', 'aria-checked': attrs.legacyChecked },
    },
    legacyDisabled: { default: null, validate: checkboxValue,
      parseHTML: element => element.getAttribute('role') === 'checkbox' && ['true','false'].includes(element.getAttribute('aria-disabled') ?? '') ? element.getAttribute('aria-disabled') : null,
      renderHTML: attrs => attrs.legacyDisabled === null ? {} : { 'aria-disabled': attrs.legacyDisabled },
    },
  } }],
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      // Focusability belongs to the editor DOM only, never to the saved manifest.
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'listItem' && node.attrs.legacyChecked !== null)
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { tabindex: '0' }));
        });
        return DecorationSet.create(state.doc, decorations);
      },
      handleDOMEvents: {
        click(view, event) { return toggle(view, event); },
        keydown(view, event) { return event.key === ' ' && toggle(view, event); },
      },
    } })];
    function toggle(view: import('prosemirror-view').EditorView, event: Event): boolean {
      const target = event.target as HTMLElement | null;
      // Clicking/editing paragraph text must not toggle the item. A focused item
      // responds to Space; a click on its checkbox marker targets the li itself.
      if (!target?.matches('li[role="checkbox"]')) return false;
      const pos = view.posAtDOM(target, 0) - 1;
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== 'listItem' || node.attrs.legacyChecked === null) return false;
      event.preventDefault();
      if (view.editable && node.attrs.legacyDisabled !== 'true') view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs, legacyChecked: node.attrs.legacyChecked === 'true' ? 'false' : 'true',
      }));
      // Collaborative bindings may replace the li when its attributes change.
      // Keep keyboard focus on the current node so repeated Space/Tab still work.
      if (event.type === 'keydown') (view.nodeDOM(pos) as HTMLElement | null)?.focus();
      return true;
    }
  },
});
// The nested code element is independently addressable by existing comment anchors.
const IdentifiedStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => extension.name === 'codeBlock'
      ? (extension as Node).extend({ renderHTML({node,HTMLAttributes}) {
        return ['pre',HTMLAttributes,['code',{
          ...(node.attrs.codeAfId ? {'data-af-id':node.attrs.codeAfId} : {}),
          ...(node.attrs.language ? {class:this.options.languageClassPrefix+node.attrs.language} : {}),
        },0]];
      } }) : extension.name === 'listItem' ? (extension as Node).extend({content:'(paragraph | heading) block*'})
        // The editor's shortcut extension binds inline code and reserves Control+E for navigation.
        : extension.name === 'code' ? (extension as Mark).extend({ addKeyboardShortcuts: () => ({}) })
        : extension);
  },
});
/** What an editor shows for an image: the address the served page gave it (by its id), else an upload's raw address,
 * an external one through the page's first-view door (as the served page shows one no cached copy covers yet, so the
 * editor's browser never fetches it from its own host), or the source as stored. */
const imageAddress = (src: string, afId: unknown, options: NativeExtensionOptions): string => {
  const shown = typeof afId === 'string' ? options.servedImages?.get(afId) : undefined;
  if (shown) return shown;
  const id = ARTIFACT_REFERENCE_PATTERN.exec(src)?.[1];
  if (id) return `/a/${id}/raw`;
  return options.pageId && /^https:\/\//i.test(src) ? `/a/${options.pageId}/assets?u=${encodeURIComponent(src)}` : src;
};
/** A pasted or dropped `<img>`'s source: the stored one a copy carries (`data-af-src`), else its `src`; null when the
 * document may not hold it. */
const imageSource = (element: HTMLElement): string | null => {
  const stored = element.getAttribute('data-af-src'), shown = element.getAttribute('src');
  const src = stored && imageAllowed(stored) ? stored : shown;
  return src && imageAllowed(src) ? src : null;
};
const NativeImage = (options: NativeExtensionOptions) => TiptapNode.create({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  marks: '',
  // Tiptap reads each attribute through its own parseHTML (over a rule's getAttrs); the rule only refuses.
  addAttributes: () => ({
    src: { default: null, parseHTML: imageSource },
    alt: { default: '', parseHTML: element => element.getAttribute('alt') ?? '' },
    title: { default: null, parseHTML: element => element.getAttribute('title')?.slice(0, IMAGE_TITLE_MAX) ?? null },
  }),
  parseHTML: () => [{ tag: 'img', getAttrs: element => (imageSource(element) ? null : false) }],
  renderHTML: ({ node, HTMLAttributes }) => {
    const src = String(node.attrs.src ?? '');
    return ['img', { ...HTMLAttributes, src: imageAddress(src, node.attrs.afId, options), 'data-af-src': src, alt: node.attrs.alt ?? '' }];
  },
});
export interface NativeExtensionOptions {
  /** The served page's image addresses by image id (`data-af-id`), which the editor shows in place of the stored source. */
  servedImages?: ReadonlyMap<string, string>;
  /** The page's id, for the first-view door (`/a/<id>/assets?u=`) an external image no served address covers shows through. */
  pageId?: string;
}
export function nativeExtensions(options: NativeExtensionOptions = {}) {
  return [IdentifiedStarterKit.configure({ undoRedo: false, trailingNode: false, underline: false, strike: false,
    codeBlock: { enableTabIndentation: true, tabSize: 2 },
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: href => safeHref(href) === href },
  }), TaskList, TaskItem.extend({content:'(paragraph | heading) block*'}).configure({ nested: true }), NativeImage(options), Identity, LegacyCheckbox];
}
export const nativeSchema = /* @__PURE__ */ getSchema(/* @__PURE__ */ nativeExtensions());
