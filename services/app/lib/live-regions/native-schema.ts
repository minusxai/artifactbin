/** Versioned native tree schema. Browser and server use precisely the same supported nodes. */
import { Extension, getSchema, type Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { safeHref } from './href';
export const NATIVE_ROOT = 'native-v1';
const Identity = Extension.create({
  name: 'regionIdentity',
  addGlobalAttributes: () => [{
    types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'bold', 'italic', 'code', 'link'],
    attributes: { afId: { default: null, parseHTML: element => element.getAttribute('data-af-id'), renderHTML: attrs => attrs.afId ? { 'data-af-id': attrs.afId } : {} } },
  }, { types: ['codeBlock'], attributes: { codeAfId: { default: null, parseHTML: element => element.querySelector('code')?.getAttribute('data-af-id') ?? null, renderHTML: () => ({}) } } }],
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
  }), TaskList, TaskItem.configure({ nested: true }), Identity];
}
export const nativeSchema = /* @__PURE__ */ getSchema(/* @__PURE__ */ nativeExtensions());
