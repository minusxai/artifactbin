/** Native Tiptap presets. Comments have private local history; document collaboration is a separate preset. */
import { NativeCodePresentation } from '@/lib/html-runtime/native-code-presentation';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import Bold from '@tiptap/extension-bold';
import { safeHref } from '@/lib/annotations/markdown-lite';
import { isSessionMentionHref } from '@/lib/annotations/session-mentions';
import { isPersonMentionHref } from '@/lib/document/person-mentions';
import { agentNameColor } from '../lib/agent-identity';

const Mention = Node.create({
  name: 'mention', inline: true, group: 'inline', atom: true,
  addAttributes: () => ({ label: { default: '' }, href: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-comment-mention]', getAttrs: element => {
    const href = element.getAttribute('data-mention-href') ?? '';
    return isSessionMentionHref(href) || isPersonMentionHref(href) ? { label: element.textContent ?? '', href } : false;
  }}],
  renderHTML: ({ node }) => ['span', {
    'data-comment-mention': '', 'data-mention-href': node.attrs.href,
    contenteditable: 'false',
    style: `--mention-color:${agentNameColor(String(node.attrs.label).replace(/^@/, ''))}`,
  }, node.attrs.label],
});

export function commentExtensions() {
  return [StarterKit.configure({
    bold: false, code: false, strike: false, underline: false, horizontalRule: false,
    trailingNode: false,
    codeBlock: { enableTabIndentation: true, tabSize: 2 },
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: url => safeHref(url) !== null },
  }), NativeCodePresentation, Bold.extend({ name: 'strong', priority: 1000 }), Code.extend({ excludes: '' }), Mention];
}
