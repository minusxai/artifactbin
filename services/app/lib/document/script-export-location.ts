/**
 * WHERE THE HELMET SCRIPT DEFINES A COMPONENT: the offset (in the document source) and 1-based line of the export
 * that a markup tag mounts, so the editor can open the source there (a mount badge's "Edit script").
 *
 * Searched in the script's RAW source text — the template literal as written in the document — so the offset is the
 * document's own, whatever escapes the literal carries. `export function Name`, `export const|let|var|class Name`
 * and a name in an `export { … }` list are found; anything else is null (the caller opens the script's top).
 */
import { parseJsx } from '@/lib/jsx/parse';
import { splitHelmet } from './helmet';

interface ScriptExportLocation { offset: number; line: number }

export function scriptExportLocation(source: string, component: string): ScriptExportLocation | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(component)) return null;
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { helmet } = splitHelmet(parsed.nodes);
  const script = helmet?.children.find((child) => child.type === 'element' && child.tag === 'script');
  const body = script?.type === 'element' ? script.children.find((child) => child.type === 'expression') : undefined;
  if (!body) return null;
  const text = source.slice(body.start, body.end);
  const name = component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declared = new RegExp(`\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s+${name}(?![\\w$])`).exec(text);
  const listed = declared ? null : new RegExp(`\\bexport\\s*\\{[^}]*?(?:^|[\\s,{])${name}(?![\\w$])[^}]*\\}`).exec(text);
  const found = declared ?? listed;
  if (!found) return null;
  const offset = body.start + found.index;
  return { offset, line: source.slice(0, offset).split('\n').length };
}
