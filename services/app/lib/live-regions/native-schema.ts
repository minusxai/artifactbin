/** Versioned native tree schema. Browser and server use precisely the same supported nodes. */
import { Extension, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { safeHref } from './href';
export const NATIVE_ROOT = 'native-v1';
const Identity = Extension.create({
  name: 'regionIdentity',
  addGlobalAttributes: () => [{
    types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule'],
    attributes: { afId: { default: null, parseHTML: element => element.getAttribute('data-af-id'), renderHTML: attrs => attrs.afId ? { 'data-af-id': attrs.afId } : {} } },
  }],
});
export function nativeExtensions() {
  return [StarterKit.configure({ undoRedo: false, trailingNode: false, underline: false, strike: false,
    codeBlock: { enableTabIndentation: true, tabSize: 2 },
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: href => safeHref(href) === href },
  }), TaskList, TaskItem.configure({ nested: true }), Identity];
}
export const nativeSchema = /* @__PURE__ */ getSchema(/* @__PURE__ */ nativeExtensions());
