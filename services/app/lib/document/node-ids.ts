import type { SourceRepair } from '@/lib/jsx/repair';
/** Source identity policy only; storage reserves emitted ids in its write transaction. */

import { parseJsx, serializeJsx, type JsxAttribute, type JsxElement, type JsxNode } from '@/lib/jsx';

interface NodeIdEntry { id: string; path: string; node: JsxElement }
interface NodeIdRepair { path: string; from: string | null; to: string; reason: 'duplicate' | 'invalid' }
interface NodeIdOptions {
  previousSource?: string | null;
  /** Lifetime ledger, not just the current head. Only fresh generation excludes these. */
  reservedIds?: Iterable<string>;
  /** Defaults to cryptographic letter-first, four-character ids. */
  mint?: () => string;
}
interface NodeIdResult {
  source: string;
  ids: string[];
  minted: number;
  carried: number;
  repairs: NodeIdRepair[];
}

const ID_ATTR = 'id';
const FIRST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const REST = FIRST + '0123456789';
const MINT_ATTEMPTS = 64;
const FALLBACK_ATTEMPTS = 4096;

interface Walked { node: JsxElement; path: string }

const attr = (node: JsxElement, name: string): JsxAttribute | undefined =>
  node.attributes.find((candidate) => candidate.name === name);

const stringValue = (attribute: JsxAttribute | undefined): string | null => {
  const value = attribute?.value;
  return value?.static && typeof value.json === 'string' && value.json !== '' && !/[\t\n\f\r ]/.test(value.json) ? value.json : null;
};

const reportedValue = (attribute: JsxAttribute | undefined): string | null => {
  const value = attribute?.value;
  return value?.static && typeof value.json === 'string' ? value.json : null;
};

/** Every body element's id names its source node. Control expressions are not elements. */
const carriesNodeId = (node: JsxElement): boolean => !node.control;

/** Helmet is metadata/code, not part of the addressable document body. */
function elements(nodes: JsxNode[]): Walked[] {
  const out: Walked[] = [];
  const visit = (list: JsxNode[], prefix: string) => {
    for (let index = 0; index < list.length; index++) {
      const node = list[index];
      if (node.type !== 'element' || node.tag === 'Helmet') continue;
      const path = prefix ? `${prefix}.${index}` : String(index);
      if (carriesNodeId(node)) out.push({ node, path });
      visit(node.children, path);
    }
  };
  visit(nodes, '');
  return out;
}

function parsed(source: string): JsxNode[] {
  const result = parseJsx(source);
  if (!result.ok) throw new Error(`node-ids: invalid JSX${result.pos === undefined ? '' : ` at ${result.pos}`}: ${result.error}`);
  return result.nodes;
}

const encoded = (value: unknown): string => JSON.stringify(value) ?? 'undefined';

/** Linear structural digest of exact parsed content, ignoring only identity attributes. */
function signatures(nodes: JsxNode[], pool:Map<string,string>): Map<JsxElement, string> {
  const intern=(value:string)=>{let id=pool.get(value);if(id===undefined){id=String(pool.size);pool.set(value,id);}return id;};
  const result = new Map<JsxElement, string>();
  const digest = (node: JsxNode): string => {
    if (node.type === 'text') return intern(encoded(['text', node.value]));
    if (node.type === 'expression') return intern(encoded(['expression', node.value]));
    const attributes = node.attributes
      .filter((a) => a.name !== ID_ATTR)
      .map((a) => [a.name, a.value]);
    const children = node.children.map(digest);
    const value = intern(encoded(['element', node.tag, node.selfClosing, attributes, children]));
    result.set(node, value);
    return value;
  };
  for (const node of nodes) digest(node);
  return result;
}

function defaultMint(): string {
  const randomInt=(max:number)=>{const values=new Uint32Array(1),limit=Math.floor(0x100000000/max)*max;do{globalThis.crypto.getRandomValues(values);}while(values[0]!>=limit);return values[0]!%max;};
  return FIRST[randomInt(FIRST.length)]
    + Array.from({ length: 3 }, () => REST[randomInt(REST.length)]).join('');
}

function setStringAttr(node: JsxElement, name: string, value: string): void {
  const existing = attr(node, name);
  if (existing) existing.value = { static: true, json: value };
  else node.attributes.push({ name, value: { static: true, json: value }, start: node.start, end: node.start });
}

/** Preserve explicit ids. Recover only unambiguous exact-content matches without ids. */
export function stampNodeIds(source: string, options: NodeIdOptions = {}): NodeIdResult {
  const nodes = parsed(source);
  const walked = elements(nodes);
  const used = new Set<string>(options.reservedIds ?? []);
  const explicitIds = new Set<string>();
  // Reserve every explicit id before visiting the first node: an authored id
  // wins over generation regardless of source order.
  for (const { node } of walked) {
    const id = stringValue(attr(node, ID_ATTR));
    if (id) { used.add(id); explicitIds.add(id); }
  }

  const previousNodes = options.previousSource ? parsed(options.previousSource) : [];
  const previousWalked = elements(previousNodes);
  for (const { node } of previousWalked) {
    const id = stringValue(attr(node, ID_ATTR));
    if (id) used.add(id);
  }
  const pool=new Map<string,string>();
  const currentSignatures = signatures(nodes,pool);
  const previousSignatures = signatures(previousNodes,pool);
  const currentCounts = new Map<string, number>();
  const previousMatches = new Map<string, string[]>();
  for (const { node } of walked) {
    if (!stringValue(attr(node, ID_ATTR))) {
      const signature = currentSignatures.get(node)!;
      currentCounts.set(signature, (currentCounts.get(signature) ?? 0) + 1);
    }
  }
  for (const { node } of previousWalked) {
    const id = stringValue(attr(node, ID_ATTR));
    if (!id) continue;
    const signature = previousSignatures.get(node)!;
    const matches = previousMatches.get(signature) ?? [];
    matches.push(id);
    previousMatches.set(signature, matches);
  }

  const assigned = new Set<string>();
  const repairs: NodeIdRepair[] = [];
  let minted = 0;
  let carried = 0;
  let fallbackCounter = 0;
  const mintFresh = (): string => {
    const candidateMint = options.mint ?? defaultMint;
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const candidate = candidateMint();
      if (/^[A-Za-z][A-Za-z0-9]{3}$/.test(candidate) && !used.has(candidate) && !assigned.has(candidate)) return candidate;
    }
    // A broken/adversarial injected mint cannot hang the write. The fallback is
    // deterministic for this invocation and bounded; exhaustion is explicit.
    for (; fallbackCounter < FALLBACK_ATTEMPTS; fallbackCounter++) {
      let n = fallbackCounter;
      let candidate = FIRST[n % FIRST.length];
      n = Math.floor(n / FIRST.length);
      for (let i = 0; i < 3; i++) { candidate += REST[n % REST.length]; n = Math.floor(n / REST.length); }
      if (!used.has(candidate) && !assigned.has(candidate)) { fallbackCounter++; return candidate; }
    }
    throw new Error('node-ids: id space exhausted within bounded fallback');
  };

  const ids: string[] = [];
  for (const { node, path } of walked) {
    const idAttribute = attr(node, ID_ATTR);
    const explicit = stringValue(idAttribute);
    const originalId = reportedValue(idAttribute);
    let id: string;
    if (explicit && !assigned.has(explicit)) {
      id = explicit;
    } else {
      const matches = !explicit ? previousMatches.get(currentSignatures.get(node)!) : undefined;
      const carry = matches?.length === 1 && currentCounts.get(currentSignatures.get(node)!) === 1
        && !assigned.has(matches[0]) && !explicitIds.has(matches[0]) ? matches[0] : null;
      id = carry ?? mintFresh();
      setStringAttr(node, ID_ATTR, id);
      if (carry) carried++; else minted++;
      if (idAttribute) repairs.push({ path, from: originalId, to: id, reason: explicit ? 'duplicate' : 'invalid' });
    }
    assigned.add(id);
    used.add(id);
    ids.push(id);
  }
  return { source: serializeJsx(nodes), ids, minted, carried, repairs };
}
/** Source-node index; real ids only, first occurrence wins on legacy malformed documents. */
export function nodeIndex(source: string): Map<string, NodeIdEntry> {
  const out = new Map<string, NodeIdEntry>();
  for (const { node, path } of elements(parsed(source))) {
    const id = stringValue(attr(node, ID_ATTR));
    if (!id || out.has(id)) continue;
    out.set(id, { id, path, node });
  }
  return out;
}

/** Publication normalization retains the repair report beside canonical source. */
export function normalizeNodeIds(source: string, options: NodeIdOptions = {}): {source:string;repairs:SourceRepair[]} {
  const result = stampNodeIds(source, options);
  return {source:result.source,repairs:result.repairs.map(repair=>({
    code:'node_id',message:`Repaired ${repair.reason} node id at ${repair.path}: ${repair.from ?? '(missing)'} → ${repair.to}. Re-read the saved file before editing.`,removed:0,...repair,
  }))};
}
