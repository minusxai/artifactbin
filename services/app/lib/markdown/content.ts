/** Markdown is source data. This boundary owns the supported vocabulary and its visible text. */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, PhrasingContent, Root } from 'mdast';
import { escapeHtml } from '@artifactbin/utils/escape';
import { renderCodeBlock } from './code-block';

export interface MarkdownContent {
  html: string;
  text: string;
  headings: Array<{ level: 1 | 2 | 3; title: string }>;
  errors: string[];
}

type MarkdownChild = { type: 'text'; value: string } | { type: 'expression'; value: { static: boolean; json?: unknown } } | { type: 'element' };
export function markdownSource(node: { tag: string; children: readonly MarkdownChild[] }): string | null {
  if (node.tag !== 'Markdown') return null;
  const values: string[] = [];
  for (const child of node.children) {
    if (child.type === 'text') { if (child.value.trim()) values.push(child.value); }
    else if (child.type === 'expression' && child.value.static && typeof child.value.json === 'string') values.push(child.value.json);
    else return null;
  }
  return values.join('');
}

export function markdownHref(href: string): boolean {
  const clean = href.replace(/[\x00-\x20]/g, '');
  return !/^[a-z][a-z\d+.-]*:/i.test(clean) || /^(https?|mailto|tel):/i.test(clean);
}

const parser = unified().use(remarkParse).use(remarkGfm);
export const parseMarkdown = (source: string): Root => parser.parse(source);
export function markdownContent(source: string): MarkdownContent {
  const result: MarkdownContent = { html: '', text: '', headings: [], errors: [] };
  type Node = RootContent | PhrasingContent;
  const render = (node: Node, inList = false, inCell = false, nested = false): { html: string; text: string } => {
    if (node.type === 'table') {
      if (nested) result.errors.push('Markdown tables must be top-level blocks, outside lists and quotes.');
      const rows = node.children.map((row, rowIndex) => {
        const cells = row.children.map((cell, column) => {
          const parts = cell.children.map(child => render(child, false, true));
          const tag = rowIndex === 0 ? 'th' : 'td';
          const align = node.align?.[column];
          return { html: `<${tag}${align ? ` style="text-align:${align}"` : ''}>${parts.map(part => part.html).join('')}</${tag}>`, text: parts.map(part => part.text).join('') };
        });
        return { html: `<tr>${cells.map(cell => cell.html).join('')}</tr>`, text: cells.map(cell => cell.text).join('') };
      });
      return { html: `<div class="mx-md-table-scroll"><table><thead>${rows[0]?.html ?? ''}</thead><tbody>${rows.slice(1).map(row => row.html).join('')}</tbody></table></div>`, text: rows.map(row => row.text).join('') };
    }
    if (node.type === 'html' && inCell && /^<br\s*\/?>$/i.test(node.value)) return { html: '<br>', text: '' };
    const children = 'children' in node ? node.children.map(child => render(child, node.type === 'listItem', inCell, true)) : [];
    const html = children.map(child => child.html).join('');
    const text = children.map(child => child.text).join('');
    const tag = (name: string, attrs = '') => ({ html: `<${name}${attrs}>${html}</${name}>`, text });
    switch (node.type) {
      case 'text': return { html: escapeHtml(node.value), text: node.value };
      case 'paragraph': return inList ? { html, text } : tag('p');
      case 'heading': {
        const index = result.headings.length;
        if (node.depth <= 3) result.headings.push({ level: node.depth as 1 | 2 | 3, title: text });
        return tag(`h${node.depth}`, node.depth <= 3 ? ` data-mx-markdown-heading="${index}"` : '');
      }
      case 'strong': return tag('strong');
      case 'emphasis': return tag('em');
      case 'delete': return tag('s');
      case 'inlineCode': return { html: `<code>${escapeHtml(node.value)}</code>`, text: node.value };
      case 'code': return { html: renderCodeBlock(node.value, node.lang), text: node.value };
      case 'blockquote': return tag('blockquote');
      case 'list': return tag(node.ordered ? 'ol' : 'ul', (node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : '') + (node.children.some(item => item.checked != null) ? ' class="mx-md-check-list"' : ''));
      case 'thematicBreak': return { html: '<hr>', text: '' };
      case 'listItem':
        return tag('li', node.checked != null ? ` role="checkbox" aria-checked="${node.checked}" aria-disabled="true"` : '');
      case 'link':
        if (!markdownHref(node.url)) result.errors.push('Markdown links require a safe URL (http, https, mailto, tel, or a relative URL).');
        return tag('a', ` href="${escapeHtml(node.url)}"${node.title ? ` title="${escapeHtml(node.title)}"` : ''}`);
      case 'break': return { html: '<br>', text: '' };
      default:
        result.errors.push(`Markdown does not support ${node.type}; place images and custom HTML outside the Markdown component.`);
        return { html: '', text: '' };
    }
  };
  const blocks = parseMarkdown(source).children.map(node => render(node));
  result.html = blocks.map(block => block.html).join('');
  result.text = blocks.map(block => block.text).join('');
  return result;
}
