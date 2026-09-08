import type { JsxElement, JsxNode } from '@/lib/jsx/types';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { URL_ATTRS, URL_LIST_ATTRS } from '@/lib/jsx/url-attrs';

export interface ManagedIframeScript { type: 'classic' | 'module'; source?: string; src?: string }
export interface ManagedIframeContent { html: string; scripts: ManagedIframeScript[] }
const LIMIT = 262144;
const htmlTags = new Set([...STORY_HTML_TAGS].map(tag => tag.toLowerCase()));
const deniedTags = new Set(['iframe', 'object', 'embed', 'form', 'meta', 'base', 'link', 'frame', 'frameset', 'applet', 'noscript']);
const owned = new Set(['sandbox', 'srcdoc', 'src', 'api', 'store', 'compiled', 'allow', 'credentialless']);
const deniedAttrs = new Set(['dangerouslysetinnerhtml', 'srcdoc', 'ref', 'key', 'is', '...']);
const voidTags = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'source', 'track', 'wbr']);
function fail(message: string): never { throw new Error(`Iframe: ${message}`); }
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function safeUrl(value: string, script = false): boolean {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) {
    try { const url = new URL(value); return !!url.hostname && !url.username && !url.password; } catch { return false; }
  }
  return !script && (/^#[^\s]*$/.test(value) || /^ref:[A-Za-z0-9_-]+$/.test(value)
    || /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(value));
}
function textPayload(node: JsxElement): string {
  return node.children.map(child => {
    if (child.type === 'text') return child.value;
    if (child.type === 'expression' && child.value.static && typeof child.value.json === 'string') return child.value.json;
    return fail(`<${node.tag}> requires static string content`);
  }).join('');
}

/** Compile inert author content. It is data for a child realm, never parent DOM. */
export function compileManagedIframe(node: JsxElement): ManagedIframeContent {
  if (node.tag !== 'Iframe') fail('expected managed Iframe');
  let size = 0;
  const bounded = (text: string) => { size += text.length; if (size > LIMIT) fail(`content exceeds ${LIMIT} character limit`); return text; };
  const attrs = (el: JsxElement, outer = false): string => {
    const seen = new Set<string>();
    return el.attributes.map(attr => {
      const name = attr.name.toLowerCase();
      if (seen.has(name)) fail(`duplicate attribute ${attr.name}`);
      seen.add(name);
      if (outer && owned.has(name)) fail(`${attr.name} is platform-owned`);
      if (deniedAttrs.has(name) || /^on/i.test(name) || !/^[a-z_][a-z0-9_.:-]*$/i.test(attr.name)) fail(`attribute ${attr.name} is not allowed`);
      if (!attr.value.static) fail(`attribute ${attr.name} must be static`);
      const value = attr.value.json;
      if (value !== null && typeof value === 'object') fail(`attribute ${attr.name} must be scalar`);
      if (outer && name === 'height' && (typeof value !== 'number' || !Number.isFinite(value) || value < 100 || value > 4096)) fail('height must be a number from 100 to 4096');
      if (typeof value === 'string' && URL_ATTRS.has(name) && !safeUrl(value, el.tag === 'script')) fail(`unsafe URL in ${attr.name}`);
      if (typeof value === 'string' && URL_LIST_ATTRS.has(name) && value.split(',').some(entry => !safeUrl(entry.trim().split(/\s+/)[0]))) fail(`unsafe URL in ${attr.name}`);
      if (value === null || value === false) return '';
      const mapped = attr.name === 'className' ? 'class' : attr.name === 'htmlFor' ? 'for' : attr.name;
      return bounded(value === true ? ` ${mapped}` : ` ${mapped}="${escape(String(value))}"`);
    }).join('');
  };
  attrs(node, true);
  const scripts: ManagedIframeScript[] = [];
  const render = (child: JsxNode, depth = 0): string => {
    if (depth > 100) fail('nesting limit exceeded');
    if (child.type === 'text') return bounded(escape(child.value));
    if (child.type === 'expression') {
      if (!child.value.static || (typeof child.value.json === 'object' && child.value.json !== null)) fail('children must be static scalar values');
      return bounded(escape(child.value.json === null || typeof child.value.json === 'boolean' ? '' : String(child.value.json)));
    }
    const tag = child.tag.toLowerCase();
    if (child.isComponent || deniedTags.has(tag) || (!htmlTags.has(tag) && !['script', 'style', 'title', 'canvas'].includes(tag))) fail(`disallowed inner tag <${child.tag}>`);
    const attributes = attrs(child);
    if (tag === 'script') {
      if (child.attributes.some(a => !['id', 'src', 'type'].includes(a.name))) fail('script accepts only id, src and type attributes');
      const value = (name: string) => { const a = child.attributes.find(a => a.name === name); return a?.value.static ? a.value.json : undefined; };
      const type = value('type');
      if (type !== undefined && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') fail('unsupported script type');
      const src = value('src');
      const source = bounded(textPayload(child));
      if (src !== undefined && (typeof src !== 'string' || !safeUrl(src, true))) fail('script src requires an absolute HTTP(S) URL');
      if (src !== undefined && source.trim()) fail('script cannot combine inline and external source');
      scripts.push({ type: type === 'module' ? 'module' : 'classic', ...(typeof src === 'string' ? { src } : { source }) });
      return '';
    }
    if (tag === 'style') {
      const css = textPayload(child);
      if (/<\/style/i.test(css)) fail('style cannot contain a closing style tag');
      return bounded(`<style${attributes}>${css}</style>`);
    }
    if (voidTags.has(tag)) {
      if (child.children.length) fail(`<${tag}> cannot have children`);
      return bounded(`<${tag}${attributes}>`);
    }
    return bounded(`<${tag}${attributes}>`) + child.children.map(n => render(n, depth + 1)).join('') + bounded(`</${tag}>`);
  };
  return { html: node.children.map(child => render(child)).join(''), scripts };
}
