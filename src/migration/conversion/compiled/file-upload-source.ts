import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import { readLocalSourceLiteral, sourceValueDeclaration } from "./source-manifest.ts";
import type { LegacyFileUploadSite, ReadLegacyFileUploadSites } from "./file-upload-contracts.ts";
import type { AttachmentMime } from "../../../browser/dataset-attachment-bridge-contracts.ts";
const name = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(v) && !["constructor", "prototype", "__proto__"].includes(v);
function refuse(): never { throw Error("Unsupported FileUpload scope"); }
function attrs(node: any) {
  const out = new Map<string, any>();
  for (const a of node.openingElement.attributes) {
    if (a.type !== "JSXAttribute" || !a.name?.name || out.has(a.name.name)) refuse();
    out.set(a.name.name, a.value);
  }
  return out;
}
function literal(value: any): any { return value ? readLocalSourceLiteral(value.type === "JSXExpressionContainer" ? value.expression : value) : true; }
function reference(value: unknown): string { if (typeof value !== "string" || !value.startsWith("$") || !name(value.slice(1))) refuse(); return value.slice(1); }
export const readLegacyFileUploadSites: ReadLegacyFileUploadSites = (source, visit) => {
  if (typeof source !== "string" || Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES) refuse();
  const text = "<>" + source + "</>", tree = Parser.extend(jsx()).parseExpressionAt(text, 0, { ecmaVersion: "latest" }) as any;
  if (tree.end !== text.length) refuse();
  const uploads: any[] = [], declarations: any[] = [], imports: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXElement") {
      const tag = node.openingElement.name.name;
      if (tag === "FileUpload") uploads.push(node);
      if (tag === "Value") declarations.push(node);
      if (tag === "Import") imports.push(node);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
  };
  walk(tree); if (!uploads.length) return [];
  if (uploads.length > 32) refuse();
  const declaration = (valueName: string, type: string) => {
    const nodes = declarations.filter((n) => {
      const a = n.openingElement.attributes.find((a: any) => a.name?.name === "name");
      try { return a && literal(a.value) === valueName; } catch { return false; }
    });
    if (nodes.length !== 1 || sourceValueDeclaration(nodes[0]).type !== type) refuse();
  };
  return uploads.map((node): LegacyFileUploadSite => {
    const a = attrs(node), allowed = new Set(["dataset", "value", "busy", "multiple", "maxFiles", "accept", "disabled", "label", "id", "class", "className", "aria-label"]);
    for (const key of a.keys()) if (!allowed.has(key)) refuse();
    if (node.children.some((n: any) => n.type !== "JSXText" || n.value.trim())) refuse();
    const bindingName = literal(a.get("dataset")); if (!name(bindingName)) refuse();
    const matched = imports.filter((n) => {
      const v = n.openingElement.attributes.find((a: any) => a.name?.name === "name");
      try { return v && literal(v.value) === bindingName; } catch { return false; }
    });
    if (matched.length !== 1) refuse();
    const valueName = reference(literal(a.get("value"))); declaration(valueName, "string");
    const busyName = a.has("busy") ? reference(literal(a.get("busy"))) : undefined;
    if (busyName) { declaration(busyName, "boolean"); if (busyName === valueName) refuse(); }
    const multiple = a.has("multiple") ? literal(a.get("multiple")) : false;
    if (typeof multiple !== "boolean") refuse();
    const maxFiles = a.has("maxFiles") ? literal(a.get("maxFiles")) : multiple ? 10 : 1;
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10) refuse();
    const accept = literal(a.get("accept")); if (typeof accept !== "string") refuse();
    const acceptedTypes = accept.split(",").map((s) => s.trim().toLowerCase());
    if (!acceptedTypes.length || acceptedTypes.some((s) => !["image/png", "image/jpeg", "image/webp"].includes(s)) || new Set(acceptedTypes).size !== acceptedTypes.length) refuse();
    let disabledSignal: string | undefined;
    if (a.has("disabled")) {
      const value = a.get("disabled"), expression = value?.type === "JSXExpressionContainer" ? value.expression : undefined;
      if (expression?.type === "Identifier" && expression.name.startsWith("$") && name(expression.name.slice(1))) disabledSignal = expression.name;
      else if (typeof literal(value) !== "boolean") refuse();
    }
    for (const key of ["label", "id", "class", "className", "aria-label"]) if (a.has(key) && (typeof literal(a.get(key)) !== "string" || literal(a.get(key)).length > 4096)) refuse();
    const site = { bindingName, valueName, ...(busyName ? { busyName } : {}), ...(disabledSignal ? { disabledSignal } : {}), multiple, maxFiles: multiple ? maxFiles : 1, acceptedTypes: acceptedTypes as AttachmentMime[] };
    visit?.(node, site); return site;
  });
};
