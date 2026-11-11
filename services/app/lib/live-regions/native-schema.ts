/** Versioned native tree schema. Browser and server use precisely the same supported nodes. */
import { Extension, getSchema, type Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { safeHref } from './href';
export const NATIVE_ROOT = 'native-v1';
const Identity = Extension.create({
  name: 'regionIdentity',
  addGlobalAttributes: () => [{
    types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'bold', 'italic', 'code', 'link'],
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
      } }) : extension);
  },
});
export function nativeExtensions() {
  return [IdentifiedStarterKit.configure({ undoRedo: false, trailingNode: false, underline: false, strike: false,
    codeBlock: { enableTabIndentation: true, tabSize: 2 },
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: href => safeHref(href) === href },
  }), TaskList, TaskItem.configure({ nested: true }), Identity, LegacyCheckbox];
}
export const nativeSchema = /* @__PURE__ */ getSchema(/* @__PURE__ */ nativeExtensions());
