/** Edit-only Markdown extensions. Tables keep GFM source; no editor keys or HTML are persisted. */
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $isElementNode, type LexicalNode, type TextFormatType } from 'lexical';
import { $createLinkNode } from '@lexical/link';
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from '@lexical/extension';
import { $createTableCellNode, $createTableNode, $createTableRowNode, $isTableNode, $isTableCellNode, $isTableRowNode, $findTableNode, TableCellHeaderStates, TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { TRANSFORMERS, CHECK_LIST, HIGHLIGHT, type ElementTransformer, type MultilineElementTransformer, type Transformer } from '@lexical/markdown';
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
export const markdownTransformers: Transformer[] = [table, horizontalRule, CHECK_LIST, ...TRANSFORMERS.filter(transformer => transformer !== HIGHLIGHT)]
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
