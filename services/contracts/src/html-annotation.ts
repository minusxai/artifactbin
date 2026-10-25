export interface HtmlAnnotationSegment {
  nodeId: string; quote: string;
  /** Preserve a migrated end at the next canonical character, including inline boundaries. */
  endAffinity?: 'forward';
  range: { start: number; end: number; length: number; fingerprint: string };
}
/** Explicit extension: never encode data-af-id as a compiler AST path. */
export interface HtmlNodeAnchor {
  kind: 'html-node'; v: 1; revision: string; nodeId: string | null; quote: string;
  /** Runtime-created identity scoped to this persisted source ancestor. */
  ancestorId?: string;
  /** Trusted migrated selection parts. Empty means the original selection is stale. */
  segments?: HtmlAnnotationSegment[];
  range?: { start: number; end: number; length: number; fingerprint: string };
}
export interface HtmlSelection {
  anchor: HtmlNodeAnchor;
  rect: { x: number; y: number; width: number; height: number };
}
/** Decode only after the original runtime endpoint verifies window/origin/session nonce. */
export function parseHtmlNodeAnchor(value: unknown): HtmlNodeAnchor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s);
  if (Object.keys(v).some(k => !['kind','v','revision','nodeId','quote','range','ancestorId','segments'].includes(k)) || v.kind !== 'html-node' || v.v !== 1 || !text(v.revision,256) || !v.revision || !(v.nodeId === null || text(v.nodeId,256) && !!v.nodeId) || !text(v.quote,32768)) return null;
  const anchor: HtmlNodeAnchor = { kind:'html-node',v:1,revision:v.revision,nodeId:v.nodeId,quote:v.quote };
  if (v.ancestorId !== undefined) {
    if (!text(v.ancestorId,256) || !v.ancestorId || v.nodeId === null || v.ancestorId === v.nodeId) return null;
    anchor.ancestorId=v.ancestorId;
  }
  if (v.range !== undefined) {
    if (!v.range || typeof v.range !== 'object' || Array.isArray(v.range) || v.nodeId === null) return null;
    const r=v.range as Record<string,unknown>;
    if (Object.keys(r).some(k=>!['start','end','length','fingerprint'].includes(k)) || ![r.start,r.end,r.length].every(n=>Number.isSafeInteger(n) && Number(n)>=0) || Number(r.start)>Number(r.end) || Number(r.end)>Number(r.length) || Number(r.length)>1_000_000 || !text(r.fingerprint,256) || !r.fingerprint) return null;
    anchor.range={start:Number(r.start),end:Number(r.end),length:Number(r.length),fingerprint:r.fingerprint};
  }
  if (v.segments !== undefined) {
    if (!Array.isArray(v.segments) || v.segments.length > 256 || v.nodeId === null || v.ancestorId !== undefined) return null;
    anchor.segments=[];
    for (const part of v.segments) {
      if (!part || typeof part !== "object" || Array.isArray(part) || Object.keys(part).some(k=>!["nodeId","quote","range","endAffinity"].includes(k))) return null;
      const {endAffinity,...coordinates}=part as Record<string,unknown>;
      if(endAffinity!==undefined&&endAffinity!=='forward')return null;
      const segment=parseHtmlNodeAnchor({kind:"html-node",v:1,revision:v.revision,...coordinates});
      if (!segment?.nodeId || !segment.range || segment.range.start===segment.range.end || !segment.quote) return null;
      anchor.segments.push({nodeId:segment.nodeId,quote:segment.quote,range:segment.range,...(endAffinity?{endAffinity}: {})});
    }
  }
  return anchor;
}

/** Raw text offsets are valid only while this fingerprint and length match. */
export function htmlTextFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
