/**
 * Publish-time icon policy. Keep the full Lucide map on the server (the build's
 * lib/build-assets/lucide-icons.json, lib/story/icon-glyphs), outside
 * local-validation (also bundled into the CLI) and the reader runtime.
 * Rendering stored documents still uses its fallback for legacy invalid names.
 */
import type { JsxNode, ValidationError } from '@/lib/jsx';
import { isLucideIcon } from './icon-glyphs';

/** Check the same map and normalization as the server glyph resolver. */
export function validateIconNames(nodes: JsxNode[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const visit = (node: JsxNode): void => {
    if (node.type !== 'element' || node.tag === 'Iframe') return;
    if (node.tag === 'Icon') {
      const attribute = node.attributes.find((attr) => attr.name === 'name');
      const name = attribute?.value.static ? attribute.value.json : undefined;
      const problem = typeof name !== 'string' || !name.trim()
        ? 'Icon name must be a nonempty static string.'
        : !isLucideIcon(name)
          ? `Unknown Icon name ${JSON.stringify(name)}.`
          : undefined;
      if (problem) errors.push({
        message: `${problem} Use a Lucide icon name in kebab-case or PascalCase, such as "calendar" or "Calendar" (https://lucide.dev/icons/).`,
        tag: node.tag, start: node.start, end: node.end,
      });
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return errors;
}
