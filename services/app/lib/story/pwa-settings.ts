import { parseJsx, type JsxElement } from '@/lib/jsx';
import { splitHelmet } from './helmet';

/** Source-backed install presentation. Identity and scope are not author-controlled. */
export interface PwaSettings { enabled?: boolean; name?: string; shortName?: string; icon?: string; themeColor?: string; backgroundColor?: string }
const fields = { enabled: 'enabled', name: 'name', shortName: 'short-name', icon: 'icon', themeColor: 'theme-color', backgroundColor: 'background-color' } as const;
const attr = (el: JsxElement, name: string) => {
  const value = el.attributes.find(a => a.name === name)?.value;
  return value?.static && typeof value.json === 'string' ? value.json : null;
};
const valid = (key: keyof typeof fields, value: string | boolean) => key === 'enabled' ? typeof value === 'boolean' : typeof value !== 'string' ? false : key === 'icon' ? /^[a-zA-Z0-9]{6,12}$/.test(value)
  : key === 'themeColor' || key === 'backgroundColor' ? /^#[0-9a-fA-F]{6}$/.test(value)
  : value.trim().length > 0 && value.length <= (key === 'shortName' ? 30 : 100);
const metaName = (key: keyof typeof fields) => `artifactbin:pwa-${fields[key]}`;
const keys = Object.keys(fields) as Array<keyof typeof fields>;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function readPwaSettings(source: string): PwaSettings {
  const parsed = parseJsx(source);
  if (!parsed.ok) return {};
  const { helmet } = splitHelmet(parsed.nodes);
  const result: PwaSettings = {};
  for (const key of keys) {
    const el = helmet?.children.find((n): n is JsxElement => n.type === 'element' && n.tag === 'meta' && attr(n, 'name') === metaName(key));
    let value = el ? attr(el, 'content') : null;
    if (key === 'icon') value = value?.startsWith('ref:') ? value.slice(4) : null;
    if (key === 'enabled') { if (value === 'true' || value === 'false') result.enabled = value === 'true'; }
    else if (value && valid(key, value)) result[key] = value;
  }
  return result;
}

/** Narrow source splices preserve all unrelated source and node identities. */
export function writePwaSettings(source: string, settings: PwaSettings): string {
  for (const key of keys) if (settings[key] !== undefined && !valid(key, settings[key]!)) throw new Error(`Invalid PWA ${key}`);
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('Fix the source before editing PWA settings.');
  const { helmet } = splitHelmet(parsed.nodes);
  const markup = keys.filter(key => settings[key] !== undefined).map(key => `<meta name="${metaName(key)}" content="${escape((key === 'icon' ? 'ref:' : '') + settings[key]!)}" />`).join('');
  if (!helmet) return markup ? `<Helmet>${markup}</Helmet>\n${source}` : source;
  if (helmet.selfClosing) return source.slice(0, helmet.start) + `<Helmet>${markup}</Helmet>` + source.slice(helmet.end);
  const removed = helmet.children.filter((n): n is JsxElement => n.type === 'element' && n.tag === 'meta' && keys.some(key => attr(n, 'name') === metaName(key)));
  const at = helmet.end - `</${helmet.tag}>`.length;
  let next = source.slice(0, at) + markup + source.slice(at);
  for (const node of removed.reverse()) next = next.slice(0, node.start) + next.slice(node.end);
  return next;
}
