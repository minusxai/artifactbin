/** Edit-only Markdown extensions. Tables keep GFM source; no editor keys or HTML are persisted. */
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $isElementNode, type LexicalNode, type TextFormatType } from 'lexical';
import { $createLinkNode } from '@lexical/link';
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from '@lexical/extension';
import { $createTableCellNode, $createTableNode, $createTableRowNode, $isTableNode, $isTableCellNode, $isTableRowNode, $findTableNode, TableCellHeaderStates, TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { CodeNode, $createCodeNode, $isCodeNode } from '@lexical/code';
import { TRANSFORMERS, CHECK_LIST, CODE, HIGHLIGHT, type ElementTransformer, type MultilineElementTransformer, type Transformer } from '@lexical/markdown';
import type { PhrasingContent } from 'mdast';
import { parseMarkdown } from './content';

const horizontalRule: ElementTransformer = {
  dependencies: [HorizontalRuleNode], type: 'element', triggerOnEnter: true,
  regExp: /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/,
  export: node => $isHorizontalRuleNode(node) ? '---' : null,
  replace(parent, _children, _match, importing) {
    const rule = $createHorizontalRuleNode();
    parent.replace(rule);
    if (!importing) rule.insertAfter($createParagraphNode()).selectStart();
  },
};

const fenceStart = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const fenceLine = /^ {0,3}(`+|~+)[ \t]*$/;
function stripFenceIndent(line: string, indent: number): string {
  let index = 0;
  let column = 0;
  let remainder = '';
  while (index < line.length && column < indent) {
    if (line[index] === ' ') { index++; column++; }
    else if (line[index] === '\t') {
      index++;
      const next = column + 4 - column % 4;
      if (next > indent) remainder = ' '.repeat(next - indent);
      column = next;
    } else break;
  }
  return remainder + line.slice(index);
}

/** Keep Lexical's adjacent-prose normalization from flattening CommonMark tilde fences. */
export function prepareEditorMarkdown(source: string): { source: string; transformers: Transformer[] } {
  const internalLanguages = new Map<string, string>();
  let nextInternalLanguage = 0;
  const lines = source.split('\n');
  const codeBlocks = parseMarkdown(source).children.filter(block => block.type === 'code' && block.position).reverse();
  for (const block of codeBlocks) {
    if (!block.position) continue;
    const index = block.position.start.line - 1;
    const open = lines[index]?.match(/^( {0,3})(~{3,})(.*)$/);
    if (!open) continue;
    const endLine = block.position.end.line - 1;
    const closeMatch = lines[endLine]?.match(/^ {0,3}(~+)[ \t]*$/);
    const close = closeMatch && closeMatch[1].length >= open[2].length ? endLine : lines.length;
    const body = lines.slice(index + 1, close).join('\n');
    const longestBackticks = (body.match(/`+/g) ?? []).reduce((maximum, run) => Math.max(maximum, run.length), 0);
    const delimiter = '`'.repeat(Math.max(3, longestBackticks + 1));
    let info = open[3].includes('`') ? (block.type === 'code' ? block.lang ?? '' : '') : open[3];
    if (info.includes('`')) {
      let token: string;
      do { token = `__mx_internal_code_language_${++nextInternalLanguage}__`; } while (source.includes(token));
      internalLanguages.set(token, info.split(/\s+/, 1)[0]);
      info = token;
    }
    lines[index] = `${open[1]}${delimiter}${info}`;
    if (close < lines.length) {
      const indent = lines[close].match(/^ {0,3}/)?.[0] ?? '';
      lines[close] = `${indent}${delimiter}`;
    }
  }
  return { source: lines.join('\n'), transformers: createMarkdownTransformers(internalLanguages) };
}

/** CommonMark accepts either fence marker; CodeNode keeps only code and language. */
function createFencedCode(internalLanguages: Map<string, string>): MultilineElementTransformer {
  return {
  dependencies: [CodeNode],
  type: 'multiline-element',
  regExpStart: fenceStart,
  handleImportAfterStartMatch({ lines, rootNode, startLineIndex, startMatch }) {
    const fence = startMatch[2];
    const info = startMatch[3].trim();
    if (fence[0] === '`' && info.includes('`')) return null;

    let end = lines.length;
    for (let index = startLineIndex + 1; index < lines.length; index++) {
      const match = lines[index].match(fenceLine);
      if (match?.[1][0] === fence[0] && match[1].length >= fence.length) {
        end = index;
        break;
      }
    }

    const body = lines.slice(startLineIndex + 1, end);
    const indent = [...startMatch[1]].reduce((column, character) => character === '\t' ? column + 4 - column % 4 : column + 1, 0);
    const value = body.map(line => stripFenceIndent(line, indent)).join('\n');
    const token = info.split(/\s+/, 1)[0];
    const language = (internalLanguages.get(token) ?? token) || undefined;
    internalLanguages.delete(token);
    const code = $createCodeNode(language);
    code.append($createTextNode(value));
    rootNode.append(code);
    return [true, end < lines.length ? end : lines.length - 1];
  },
  replace(parent, children, match, _end, _lines, importing) {
    if (!children || importing) return false;
    const info = match[3]?.trim() ?? '';
    const language = info.split(/\s+/, 1)[0] || undefined;
    const code = $createCodeNode(language);
    code.append(...children);
    parent.replace(code);
  },
  export(node) {
    if (!$isCodeNode(node)) return null;
    const body = node.getTextContent();
    const language = node.getLanguage() || '';
    const runs = (character: '`' | '~') => [...(body.match(new RegExp(character === '`' ? '`+' : '~+', 'g')) ?? [])]
      .reduce((maximum, run) => Math.max(maximum, run.length), 0);
    const backticks = Math.max(3, runs('`') + 1);
    const tildes = Math.max(3, runs('~') + 1);
    const marker = language.includes('`') || tildes < backticks ? '~' : '`';
    const length = marker === '`' ? backticks : tildes;
    const fence = marker.repeat(length);
    return `${fence}${language}${body ? `\n${body}` : ''}\n${fence}`;
  },
  };
}

/** mdast already resolves escapes, including pipes inside code spans and link labels. */
function cellInline(node: PhrasingContent, formats: TextFormatType[] = []): LexicalNode[] {
  if (node.type === 'text' || node.type === 'inlineCode') {
    const text = $createTextNode(node.value);
    for (const format of [...formats, ...(node.type === 'inlineCode' ? ['code' as const] : [])]) text.toggleFormat(format);
    return [text];
  }
  if (node.type === 'break' || (node.type === 'html' && /^<br\s*\/?>$/i.test(node.value))) return [$createLineBreakNode()];
  if (node.type === 'link') return [$createLinkNode(node.url, { title: node.title }).append(...node.children.flatMap(child => cellInline(child, formats)))];
  if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
    const format = node.type === 'strong' ? 'bold' : node.type === 'emphasis' ? 'italic' : 'strikethrough';
    return node.children.flatMap(child => cellInline(child, [...formats, format]));
  }
  return [];
}

const table: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode], type: 'multiline-element',
  regExpStart: /^.*\|.*$/,
  handleImportAfterStartMatch({ lines, rootNode, startLineIndex }) {
    const ast = parseMarkdown(lines.slice(startLineIndex).join('\n')).children[0];
    if (ast?.type !== 'table') return null;
    const grid = $createTableNode();
    for (const [index, row] of ast.children.entries()) {
      const tableRow = $createTableRowNode();
      for (const [column, cell] of row.children.entries()) {
        const tableCell = $createTableCellNode(index === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);
        const alignment = ast.align?.[column];
        if (alignment) tableCell.setFormat(alignment);
        tableCell.append($createParagraphNode().append(...cell.children.flatMap(child => cellInline(child))));
        tableRow.append(tableCell);
      }
      grid.append(tableRow);
    }
    rootNode.append(grid);
    return [true, startLineIndex + (ast.position?.end.line ?? 1) - 1];
  },
  replace: () => false,
  export(node, children) {
    if (!$isTableNode(node)) return null;
    const rows = node.getChildren().filter($isTableRowNode);
    const cells = rows.map(row => row.getChildren().filter($isTableCellNode));
    const line = (values: string[]) => `| ${values.join(' | ')} |`;
    const content = cells.map(row => line(row.map(cell => cell.getChildren().map(block => $isElementNode(block) ? children(block) : block.getTextContent()).join('\n')
      .replace(/\r?\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|').trim())));
    const divider = line((cells[0] ?? []).map(cell => {
      const format = cell.getFormatType();
      return format === 'center' ? ':---:' : format === 'right' ? '---:' : format === 'left' ? ':---' : '---';
    }));
    return [content[0] ?? '', divider, ...content.slice(1)].join('\n');
  },
};

// Cell content is inline Markdown: block shortcuts belong outside tables.
function createMarkdownTransformers(internalLanguages: Map<string, string>): Transformer[] {
  return [table, horizontalRule, createFencedCode(internalLanguages), CHECK_LIST, ...TRANSFORMERS.filter(transformer => transformer !== HIGHLIGHT && transformer !== CODE)]
  .map((transformer): Transformer => {
    if (transformer.type === 'element') return {
      ...transformer,
      replace(...args: Parameters<ElementTransformer['replace']>) {
        if ($findTableNode(args[0])) return false;
        return transformer.replace(...args);
      },
    };
    if (transformer.type === 'multiline-element') return {
      ...transformer,
      replace(...args: Parameters<MultilineElementTransformer['replace']>) {
        if ($findTableNode(args[0])) return false;
        return transformer.replace(...args);
      },
    };
    return transformer;
  });
}

export const markdownTransformers: Transformer[] = createMarkdownTransformers(new Map());
