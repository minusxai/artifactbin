/** Admit exact retained Markdown parses without executing authored expressions. */
import { nativeDigest } from "./selection.ts";
import type { RetainedJsxNode } from "./analyze-contracts.ts";
import type {
  NativeMarkdownInput,
  NativeMarkdownReceipt,
} from "./markdown-contracts.ts";
export function nativeMarkdownSource(node: RetainedJsxNode): string | null {
  if (node.type !== "element" || node.tag !== "Markdown") return null;
  const values: string[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      if (child.value.trim()) values.push(child.value);
    } else if (
      child.type === "expression" &&
      child.value.static &&
      typeof child.value.json === "string"
    )
      values.push(child.value.json);
    else return null;
  }
  return values.join("");
}
export function prepareNativeMarkdown(
  input: NativeMarkdownInput,
): readonly NativeMarkdownReceipt[] {
  if (!/^[a-f0-9]{64}$/.test(input.parserSha256))
    throw Error("native_markdown_parser_proof");
  const receipts: NativeMarkdownReceipt[] = [];
  const used = new Set<string>();
  const authoredIds=new Map<string,string[]>();
  const inspect=(nodes:readonly RetainedJsxNode[])=>{for(const node of nodes){if(node.type!=='element')continue;for(const attr of node.attributes)if(attr.name==='id'&&attr.value.static&&typeof attr.value.json==='string')authoredIds.set(attr.value.json,[...(authoredIds.get(attr.value.json)??[]),node.graphKey]);inspect(node.children);}};inspect(input.analysis.nodes);
  const walk = (nodes: readonly RetainedJsxNode[]) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tag !== "Markdown") {
        walk(node.children);
        continue;
      }
      const source = nativeMarkdownSource(node),
        parsed = input.parsed.filter((p) => p.sourceNode === node.graphKey),
        bindings = input.identity.bindings.filter(
          (b) => b.sourceNode === node.graphKey,
        );
      if (
        source === null ||
        parsed.length !== 1 ||
        parsed[0]!.source !== source ||
        parsed[0]!.errors.length ||
        bindings.length !== 1
      )
        throw Error("native_markdown_source_proof");
      const id = node.attributes.filter((a) => a.name === "id");
      if (
        id.length > 1 ||
        id.some((a) => !a.value.static || typeof a.value.json !== "string")
      )
        throw Error("native_markdown_host_id");
      const hostAfId = bindings[0]!.afId,
        idValue = id[0]?.value;
      const hostDomId = idValue?.static
        ? String(idValue.json)
        : `native-md-${hostAfId}`;
      if (
        !hostDomId ||
        /[\u0000-\u0020\u007f]/.test(hostDomId) ||
        used.has(hostDomId)
      )
        throw Error("native_markdown_host_id");
      used.add(hostDomId);
      const item = parsed[0]!;
      if (
        item.headings.some(
          (h) => ![1, 2, 3].includes(h.level) || typeof h.title !== "string",
        )
      )
        throw Error("native_markdown_heading_proof");
      for(const domId of [hostDomId,...item.headings.map((_,index)=>`${hostDomId}-heading-${index}`)]){
       if((authoredIds.get(domId)??[]).some(key=>key!==node.graphKey)||domId!==hostDomId&&used.has(domId))throw Error('native_markdown_heading_collision');
       if(domId!==hostDomId)used.add(domId);
      }
      const payload = {
        sourceNode: item.sourceNode,
        source: item.source,
        html: item.html,
        headings: item.headings,
        errors: item.errors,
        analysisSha256: input.analysis.analysisSha256,
        sourceSha256: input.analysis.sourceSha256,
        nodeSha256: nativeDigest(node),
        parserSha256: input.parserSha256,
        hostAfId,
        hostDomId,
      };
      receipts.push({ ...payload, sha256: nativeDigest(payload) });
    }
  };
  walk(input.analysis.nodes);
  if (receipts.length !== input.parsed.length)
    throw Error("native_markdown_extra_parse");
  return receipts;
}
export function verifyNativeMarkdown(
  input: NativeMarkdownInput,
  receipt: NativeMarkdownReceipt,
): boolean {
  try {
    return prepareNativeMarkdown(input).some(
      (item) => nativeDigest(item) === nativeDigest(receipt),
    );
  } catch {
    return false;
  }
}
