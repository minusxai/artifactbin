/**
 * THE PAGE AS A SCRIPT SEES IT: integer handles for elements under the story root, text (written into
 * the node a binding holds, so the data keeps winning) and form values on any of them, attributes only
 * on elements the script made, classes checked token by token,
 * listeners for a fixed set of events, and elements it creates marked `data-mx-author` so the live
 * morph and the serializer never mistake them for authored markup. Every string is bounded and every
 * attribute goes through lib/jsx/attribute-policy. Nothing here touches the interpreter: it answers
 * JSON-shaped calls and fires callbacks by id (./realm owns the realm side).
 */
import { AUTHOR_ELEMENT_TAGS, AUTHOR_CLASSES_PER_CALL, authorAttributeRefusal, authorClassRefusal } from '@/lib/jsx/attribute-policy';
import { AUTHOR_REALM_LIMITS as L } from './limits';

export const AUTHOR_NODE_ATTR = 'data-mx-author';
/** The events a script may listen for. */
export const AUTHOR_EVENT_TYPES: ReadonlySet<string> = new Set(['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'focus', 'blur', 'pointerdown', 'pointerup', 'toggle']);
const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'TEMPLATE', 'OBJECT', 'EMBED']);
const FRAME_SELECTOR = '[data-mx-managed-frame]';

export interface DomHostOptions {
  root: HTMLElement;
  doc: Document;
  /** Deliver an event to the realm's callback `id`. */
  fire(id: number, args: unknown[]): void;
}
export interface DomHost {
  /** Answer one `dom.*` call; returns the JSON reply or undefined for none. Throws a coded Error to refuse. */
  call(op: string, args: unknown[]): string | undefined;
  /** Remove every listener and every element the script created. */
  dispose(): void;
}

const refuse = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const str = (value: unknown, what: string, limit: number): string => {
  if (typeof value !== 'string') return refuse('INVALID_VALUE', `Expected a string ${what}`);
  if (value.length > limit) return refuse('INVALID_VALUE', `${what} exceeds ${limit} characters`);
  return value;
};

export function createDomHost({ root, doc, fire }: DomHostOptions): DomHost {
  const byHandle = new Map<number, Element>();
  const handles = new WeakMap<Element, number>();
  const created = new Set<Element>();
  const listeners = new Map<number, { el: Element; type: string; listener: (event: Event) => void }>();
  let nextHandle = 0;
  let disposed = false;

  const inScope = (el: Element): boolean => !EXCLUDED_TAGS.has(el.tagName) && !el.closest(FRAME_SELECTOR)
    && (created.has(el) || (el.isConnected && root.contains(el)));
  const handleOf = (el: Element): number => {
    let handle = handles.get(el);
    if (handle === undefined) { handle = ++nextHandle; handles.set(el, handle); byHandle.set(handle, el); }
    return handle;
  };
  const elementOf = (value: unknown): Element => {
    const el = typeof value === 'number' ? byHandle.get(value) : undefined;
    if (!el) return refuse('UNKNOWN_NODE', 'Expected a node handle from dom.query or dom.create');
    if (!inScope(el)) return refuse('STALE_NODE', 'The node is no longer on the page');
    return el;
  };
  const authored = (el: Element, what: string): Element => (el.hasAttribute(AUTHOR_NODE_ATTR) ? el
    : refuse('PAGE_OWNED', `${what} applies only to elements the script created with dom.create; use dom.setText, dom.setValue or classes on the page's own`));
  const select = (value: unknown, all: boolean): Element[] => {
    const selector = str(value, 'selector', L.selectorChars);
    let found: Element[];
    // The root itself answers too: `querySelector` searches descendants only.
    try { found = all ? [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)] : [root.matches(selector) ? root : root.querySelector(selector)].filter((el): el is Element => !!el); }
    catch { return refuse('INVALID_SELECTOR', `Invalid selector ${JSON.stringify(selector.slice(0, 80))}`); }
    return found.filter(inScope).slice(0, L.queryAllResults);
  };
  const classes = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length > AUTHOR_CLASSES_PER_CALL) return refuse('INVALID_VALUE', `Expected up to ${AUTHOR_CLASSES_PER_CALL} class names`);
    return value.map((token) => { const text = str(token, 'class', 256); const reason = authorClassRefusal(text); return reason ? refuse('INVALID_CLASS', reason) : text; });
  };
  const describe = (event: Event): Record<string, unknown> => {
    const target = event.target instanceof Element && inScope(event.target) ? event.target : null;
    const out: Record<string, unknown> = { type: event.type, target: target ? handleOf(target) : null };
    if (target && CONTROL_TAGS.has(target.tagName)) {
      const control = target as HTMLInputElement;
      out.value = String(control.value ?? '').slice(0, L.textChars);
      if (control.type === 'checkbox' || control.type === 'radio') out.checked = control.checked;
    }
    const keyed = event as KeyboardEvent; if (typeof keyed.key === 'string') { out.key = keyed.key; out.code = keyed.code; }
    const pointed = event as MouseEvent; if (typeof pointed.clientX === 'number') { out.clientX = pointed.clientX; out.clientY = pointed.clientY; out.button = pointed.button; }
    const modifiers = event as KeyboardEvent; if (typeof modifiers.altKey === 'boolean') { out.altKey = modifiers.altKey; out.ctrlKey = modifiers.ctrlKey; out.metaKey = modifiers.metaKey; out.shiftKey = modifiers.shiftKey; }
    return out;
  };
  const settle = (el: Element) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };

  const ops: Record<string, (args: unknown[]) => unknown> = {
    query: ([selector]) => { const [el] = select(selector, false); return el ? handleOf(el) : null; },
    queryAll: ([selector]) => select(selector, true).map(handleOf),
    text: ([node]) => (elementOf(node).textContent ?? '').slice(0, L.textChars),
    setText: ([node, value]) => {
      const el = elementOf(node);
      const text = str(value, 'text', L.textChars);
      // Keep a lone text node's identity: a binding Solid holds (`{$value}`) keeps writing to that node,
      // so the document's data wins again on its next change instead of updating a detached node.
      const only = el.childNodes.length === 1 && el.firstChild?.nodeType === 3 ? el.firstChild as Text : null;
      if (only) only.data = text; else el.textContent = text;
    },
    value: ([node]) => {
      const el = elementOf(node);
      if (!CONTROL_TAGS.has(el.tagName)) return refuse('NOT_A_CONTROL', 'dom.value reads input, textarea and select elements');
      const control = el as HTMLInputElement;
      return control.type === 'checkbox' || control.type === 'radio' ? control.checked : String(control.value ?? '').slice(0, L.textChars);
    },
    setValue: ([node, value]) => {
      const el = elementOf(node);
      if (!CONTROL_TAGS.has(el.tagName)) return refuse('NOT_A_CONTROL', 'dom.setValue sets input, textarea and select elements');
      const control = el as HTMLInputElement;
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = value === true || value === 'true' || value === 'on';
      else control.value = str(value, 'value', L.textChars);
      settle(el);
    },
    attr: ([node, name]) => elementOf(node).getAttribute(str(name, 'attribute name', 128)),
    setAttr: ([node, name, value]) => {
      const el = authored(elementOf(node), 'dom.setAttr');
      const attribute = str(name, 'attribute name', 128); const text = str(value, 'attribute value', L.textChars);
      const reason = authorAttributeRefusal(attribute, text);
      if (reason) refuse('INVALID_ATTRIBUTE', reason);
      el.setAttribute(attribute, text);
    },
    removeAttr: ([node, name]) => {
      const el = authored(elementOf(node), 'dom.removeAttr');
      const attribute = str(name, 'attribute name', 128);
      const reason = authorAttributeRefusal(attribute, '');
      if (reason) refuse('INVALID_ATTRIBUTE', reason);
      el.removeAttribute(attribute);
    },
    addClass: ([node, list]) => { elementOf(node).classList.add(...classes(list)); },
    removeClass: ([node, list]) => { elementOf(node).classList.remove(...classes(list)); },
    toggleClass: ([node, name, force]) => {
      const el = elementOf(node); const [token] = classes([name]);
      return typeof force === 'boolean' ? el.classList.toggle(token!, force) : el.classList.toggle(token!);
    },
    hasClass: ([node, name]) => { const el = elementOf(node); const [token] = classes([name]); return el.classList.contains(token!); },
    on: ([node, type, id, prevent]) => {
      const el = elementOf(node);
      const event = str(type, 'event type', 32);
      if (!AUTHOR_EVENT_TYPES.has(event)) refuse('INVALID_EVENT', `Scripts may listen for ${[...AUTHOR_EVENT_TYPES].join(', ')}`);
      if (typeof id !== 'number' || listeners.has(id)) refuse('INVALID_REQUEST', 'Invalid listener');
      if (listeners.size >= L.listeners) refuse('LIMIT', `A script may hold up to ${L.listeners} listeners`);
      const listener = (e: Event) => { if (disposed) return; if (prevent === true) e.preventDefault(); fire(id as number, [describe(e)]); };
      el.addEventListener(event, listener);
      listeners.set(id as number, { el, type: event, listener });
    },
    off: ([id]) => { const entry = typeof id === 'number' ? listeners.get(id) : undefined; if (entry) { entry.el.removeEventListener(entry.type, entry.listener); listeners.delete(id as number); } },
    create: ([tag, value]) => {
      const name = str(tag, 'tag', 32).toLowerCase();
      if (!AUTHOR_ELEMENT_TAGS.has(name)) refuse('INVALID_TAG', `Scripts may create ${[...AUTHOR_ELEMENT_TAGS].join(', ')}`);
      if (created.size >= L.nodes) refuse('LIMIT', `A script may create up to ${L.nodes} elements`);
      const el = doc.createElement(name);
      el.setAttribute(AUTHOR_NODE_ATTR, '');
      if (value !== null) el.textContent = str(value, 'text', L.textChars);
      created.add(el);
      return handleOf(el);
    },
    append: ([parent, child]) => {
      const into = elementOf(parent); const el = authored(elementOf(child), 'dom.append');
      if (el === into || el.contains(into)) refuse('INVALID_VALUE', 'An element cannot contain itself');
      into.append(el);
    },
    remove: ([node]) => { const el = authored(elementOf(node), 'dom.remove'); el.remove(); for (const [id, entry] of listeners) if (el.contains(entry.el)) { entry.el.removeEventListener(entry.type, entry.listener); listeners.delete(id); } },
    connected: ([node]) => { const el = typeof node === 'number' ? byHandle.get(node) : undefined; return !!el && inScope(el) && el.isConnected; },
  };

  return {
    call(op, args) {
      if (disposed) return refuse('STALE_INSTANCE', 'Script session closed');
      const run = ops[op];
      if (!run) return refuse('INVALID_REQUEST', `Unsupported page operation ${op}`);
      const value = run(args);
      return value === undefined ? undefined : JSON.stringify(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { el, type, listener } of listeners.values()) el.removeEventListener(type, listener);
      listeners.clear();
      for (const el of created) el.remove();
      created.clear(); byHandle.clear();
    },
  };
}
