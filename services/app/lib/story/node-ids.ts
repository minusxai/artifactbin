/** Source identity policy only; storage reserves emitted ids in its write transaction. */
import crypto from 'crypto';
import { parseJsx, serializeJsx, type JsxAttribute, type JsxElement, type JsxNode } from '@/lib/jsx';

export interface NodeIdEntry { id: string; path: string; node: JsxElement; legacyKey: string | null }
export interface NodeIdRepair { path: string; from: string | null; to: string; reason: 'duplicate' | 'invalid' }
export interface NodeIdAlias { legacyKey: string; nodeId: string; path: string }
export interface NodeIdOptions {
  previousSource?: string | null;
  /** Lifetime ledger, not just the current head. Only fresh generation excludes these. */
  reservedIds?: Iterable<string>;
  /** Defaults to cryptographic letter-first, four-character ids. */
  mint?: () => string;
  /** Removing conflicting legacy attributes requires atomic relation migration by caller. */
  retireLegacyAliases?: boolean;
}
export interface NodeIdResult {
  source: string;
  ids: string[];
  minted: number;
  carried: number;
  repairs: NodeIdRepair[];
  aliases: NodeIdAlias[];
}

const ID_ATTR = 'id';
const LEGACY_ATTR = 'data-annotation-anchor';
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

/** Helmet is metadata/code, not part of the addressable document body. */
function elements(nodes: JsxNode[]): Walked[] {
  const out: Walked[] = [];
  const visit = (list: JsxNode[], prefix: string) => {
    for (let index = 0; index < list.length; index++) {
      const node = list[index];
      if (node.type !== 'element' || node.tag === 'Helmet') continue;
      const path = prefix ? `${prefix}.${index}` : String(index);
      out.push({ node, path });
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
function signatures(nodes: JsxNode[]): Map<JsxElement, string> {
  const result = new Map<JsxElement, string>();
  const digest = (node: JsxNode): string => {
    if (node.type === 'text') return crypto.createHash('sha256').update(encoded(['text', node.value])).digest('hex');
    if (node.type === 'expression') return crypto.createHash('sha256').update(encoded(['expression', node.value])).digest('hex');
    const attributes = node.attributes
      .filter((a) => a.name !== ID_ATTR && a.name !== LEGACY_ATTR)
      .map((a) => [a.name, a.value]);
    const children = node.children.map(digest);
    const value = crypto.createHash('sha256').update(encoded(['element', node.tag, node.selfClosing, attributes, children])).digest('hex');
    result.set(node, value);
    return value;
  };
  for (const node of nodes) digest(node);
  return result;
}

function defaultMint(): string {
  const bytes = crypto.randomBytes(4);
  return FIRST[bytes[0] % FIRST.length] + Array.from(bytes.slice(1), (byte) => REST[byte % REST.length]).join('');
}

function setStringAttr(node: JsxElement, name: string, value: string): void {
  const existing = attr(node, name);
  if (existing) existing.value = { static: true, json: value };
  else node.attributes.push({ name, value: { static: true, json: value }, start: node.start, end: node.start });
}

function removeAttr(node: JsxElement, name: string): void {
  node.attributes = node.attributes.filter((candidate) => candidate.name !== name);
}

/** Preserve explicit ids. Recover only unambiguous exact-content matches without ids. */
export function stampNodeIds(source: string, options: NodeIdOptions = {}): NodeIdResult {
  const nodes = parsed(source);
  const walked = elements(nodes);
  const used = new Set<string>(options.reservedIds ?? []);
  const explicitIds = new Set<string>();
  // Reserve every explicit id and valid legacy identity before visiting the
  // first node. Both win over generation regardless of source order; authored
  // ids still win when the two namespaces collide on different nodes.
  for (const { node } of walked) {
    const id = stringValue(attr(node, ID_ATTR));
    if (id) { used.add(id); explicitIds.add(id); }
    const legacy = stringValue(attr(node, LEGACY_ATTR));
    if (legacy) used.add(legacy);
  }

  const previousNodes = options.previousSource ? parsed(options.previousSource) : [];
  const previousWalked = elements(previousNodes);
  for (const { node } of previousWalked) {
    const id = stringValue(attr(node, ID_ATTR));
    if (id) used.add(id);
  }
  const currentSignatures = signatures(nodes);
  const previousSignatures = signatures(previousNodes);
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
  const aliases: NodeIdAlias[] = [];
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
    const legacy = stringValue(attr(node, LEGACY_ATTR));
    let id: string;
    if (explicit && !assigned.has(explicit)) {
      id = explicit;
    } else if (!explicit && legacy && !assigned.has(legacy) && !explicitIds.has(legacy)) {
      id = legacy;
      setStringAttr(node, ID_ATTR, id);
      removeAttr(node, LEGACY_ATTR);
    } else {
      const matches = !explicit && !legacy ? previousMatches.get(currentSignatures.get(node)!) : undefined;
      const carry = matches?.length === 1 && currentCounts.get(currentSignatures.get(node)!) === 1
        && !assigned.has(matches[0]) && !explicitIds.has(matches[0]) ? matches[0] : null;
      id = carry ?? mintFresh();
      setStringAttr(node, ID_ATTR, id);
      if (carry) carried++; else minted++;
      if (idAttribute) repairs.push({ path, from: originalId, to: id, reason: explicit ? 'duplicate' : 'invalid' });
      if (legacy) aliases.push({ legacyKey: legacy, nodeId: id, path });
      if (legacy && options.retireLegacyAliases) removeAttr(node, LEGACY_ATTR);
    }
    if (explicit && id === explicit && legacy && explicit !== legacy) {
      aliases.push({ legacyKey: legacy, nodeId: id, path });
      if (options.retireLegacyAliases) removeAttr(node, LEGACY_ATTR);
    }
    assigned.add(id);
    used.add(id);
    ids.push(id);
  }
  return { source: serializeJsx(nodes), ids, minted, carried, repairs, aliases };
}
/** Source-node index; real ids only, first occurrence wins on legacy malformed documents. */
export function nodeIndex(source: string): Map<string, NodeIdEntry> {
  const out = new Map<string, NodeIdEntry>();
  for (const { node, path } of elements(parsed(source))) {
    const id = stringValue(attr(node, ID_ATTR));
    if (!id || out.has(id)) continue;
    out.set(id, { id, path, node, legacyKey: stringValue(attr(node, LEGACY_ATTR)) });
  }
  return out;
}
