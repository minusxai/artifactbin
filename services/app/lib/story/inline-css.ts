import * as cssTree from 'css-tree';
import { sha256Hex } from '@/lib/sha256';

const INLINE_ROOT = '[data-mx-inline-story]';
const SAFE_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'keyframes', '-webkit-keyframes', 'font-face', 'starting-style']);
const familyKey = (name: string) => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
const decoded = (name: string) => cssTree.ident.decode(name);

/** Scope a complete document stylesheet for a shared app document. Browser safe.
 * Combine base + compiled + author CSS BEFORE calling: font definitions and
 * references must share one namespace. Never pass first-party controls CSS.
 */
export function isolateStoryCss(css: string): string {
  let ast: cssTree.CssNode;
  try { ast = cssTree.parse(css, { parseCustomProperty: true }); } catch { return ''; }
  const fonts = new Map<string, string>();
  const localDefaults: string[] = [];
  cssTree.walk(ast, {
    visit: 'Atrule',
    enter(node: cssTree.Atrule, item: cssTree.ListItem<cssTree.CssNode>, list: cssTree.List<cssTree.CssNode>) {
      const name = decoded(node.name).toLowerCase();
      if (name === 'property' && node.block && node.prelude) {
        const property = cssTree.generate(node.prelude);
        const declarations = node.block.children.toArray().filter((part): part is cssTree.Declaration => part.type === 'Declaration');
        const initial = declarations.find(part => decoded(part.property) === 'initial-value');
        const inherits = declarations.find(part => decoded(part.property) === 'inherits');
        if (/^--[\w-]+$/.test(property) && initial) {
          const selector = inherits && cssTree.generate(inherits.value) === 'true' ? INLINE_ROOT : `${INLINE_ROOT},${INLINE_ROOT} *`;
          localDefaults.push(`${selector}{${property}:${cssTree.generate(initial.value)}}`);
        }
      }
      if (!SAFE_AT_RULES.has(name)) { if (item) list.remove(item); return this.skip; }
      if (name !== 'font-face' || !node.block) return;
      node.block.children.forEach(decl => {
        if (decl.type !== 'Declaration' || decoded(decl.property).toLowerCase() !== 'font-family') return;
        const key = familyKey(cssTree.generate(decl.value));
        const normalized = decoded(key);
        fonts.set(normalized, normalized.startsWith('mx-author-') ? normalized : `mx-author-${sha256Hex(normalized).slice(0, 16)}`);
      });
    },
  });
  if (ast.type === 'StyleSheet' && localDefaults.length) {
    const defaults = cssTree.parse(localDefaults.join(''), { parseCustomProperty: true }) as cssTree.StyleSheet;
    ast.children.prependList(defaults.children);
  }
  const safeUrl = (value: string) => /^(?:data:|#|\/(?:assets|fonts)\/|\/a\/[A-Za-z0-9]+\/(?:assets|raw|export)(?:[?/#]|$))/i.test(value.trim()) ? value : 'data:,';
  cssTree.walk(ast, {
    enter(this: cssTree.WalkContext, node: cssTree.CssNode, item: cssTree.ListItem<cssTree.CssNode>, list: cssTree.List<cssTree.CssNode>) {
      if (node.type === 'PseudoClassSelector' && ['root', 'host'].includes(decoded(node.name).toLowerCase())
        || node.type === 'TypeSelector' && ['html', 'body'].includes(decoded(node.name).toLowerCase())) {
        if (item) list.replace(item, list.createItem((cssTree.parse(INLINE_ROOT, { context: 'selector' }) as cssTree.Selector).children.first!));
      } else if (node.type === 'Url') {
        node.value = safeUrl(cssTree.url.decode(cssTree.generate(node)));
      } else if (node.type === 'Function' && ['image-set', '-webkit-image-set', 'src'].includes(decoded(node.name).toLowerCase())) {
        node.children.forEach(child => {
          if (child.type === 'String') child.value = safeUrl(cssTree.string.decode(cssTree.generate(child)));
        });
      } else if (node.type === 'Declaration') {
        const property = decoded(node.property).toLowerCase();
        if (node.value.type === 'Raw') {
          // An unparsed value is not safe to evaluate in the first-party page.
          if (item) list.remove(item);
          return this.skip;
        }
        if (!(property === 'font' || property === 'font-family' || property.startsWith('--'))) return;
        cssTree.walk(node.value, {
          enter(part: cssTree.CssNode, partItem: cssTree.ListItem<cssTree.CssNode>, partList: cssTree.List<cssTree.CssNode>) {
            if (part.type === 'String') {
              const next = fonts.get(familyKey(cssTree.string.decode(cssTree.generate(part))));
              if (next) part.value = next;
            } else if (part.type === 'Identifier' && partItem) {
              const words: string[] = [];
              const items: cssTree.ListItem<cssTree.CssNode>[] = [];
              let cursor: cssTree.ListItem<cssTree.CssNode> | null = partItem;
              while (cursor?.data.type === 'Identifier') {
                words.push(decoded(cursor.data.name)); items.push(cursor);
                cursor = cursor.next;
              }
              for (let n = words.length; n > 0; n--) {
                const next = fonts.get(familyKey(words.slice(0, n).join(' ')));
                if (!next) continue;
                partList.replace(partItem, partList.createItem({ type: 'String', value: next }));
                for (const extra of items.slice(1, n)) partList.remove(extra);
                break;
              }
            }
          },
        });
      }
    },
  });
  return cssTree.generate(ast);
}
