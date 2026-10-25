/** Source-bound port of the retained reader's outline recipe; no compiler/runtime dependency. */
import { prepareNativeMarkdown } from "./markdown.ts";
import { nativeDigest } from "./selection.ts";
import type { RetainedJsxNode } from "./analyze-contracts.ts";
import type {
  NativeContentsEntry,
  NativeReaderTemplateInput,
  NativeReaderTemplateReceipt,
  NativeReaderTemplateOutput,
} from "./reader-template-contracts.ts";
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const textOf = (node: RetainedJsxNode): string =>
  node.type === "text"
    ? node.value
    : node.type === "expression"
      ? node.value.static && typeof node.value.json === "string"
        ? node.value.json
        : ""
      : node.children.map(textOf).join("");
export function prepareNativeReaderTemplate(
  input: NativeReaderTemplateInput,
): NativeReaderTemplateReceipt {
  if (!/^[a-f0-9]{64}$/.test(input.sourceRecordSha256))
    throw Error("Reader template source record proof");
  const entries: NativeContentsEntry[] = [];
  let slides = 0,
    grid = false;
  const inspect = (nodes: readonly RetainedJsxNode[]) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.isComponent && node.tag === "Slide") {
        slides++;
        continue;
      }
      if (node.isComponent && node.tag === "Grid") grid = true;
      inspect(node.children);
    }
  };
  inspect(input.analysis.nodes);
  const discover = (nodes: readonly RetainedJsxNode[]) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.isComponent && node.tag === "Slide") continue;
      if (node.tag === "Markdown") {
        const supplied = input.markdown ?? [];
        const parserSha256 = supplied[0]?.parserSha256 ?? "";
        if (supplied.some((item) => item.parserSha256 !== parserSha256))
          throw Error("Reader Markdown parser proof");
        const verified = prepareNativeMarkdown({
          analysis: input.analysis,
          identity: input.identity,
          parsed: supplied,
          parserSha256,
        });
        if (nativeDigest(verified) !== nativeDigest(supplied))
          throw Error("Reader Markdown receipt proof");
        const receipt = verified.find(
          (item) => item.sourceNode === node.graphKey,
        );
        if (!receipt) throw Error("Reader Markdown source missing");
        receipt.headings.forEach((heading, index) => {
          if (heading.level !== 1 || input.template === "doc")
            entries.push({
              ...heading,
              sourceNode: node.graphKey,
              afId: receipt.hostAfId,
              domId: `${receipt.hostDomId}-heading-${index}`,
            });
        });
        continue;
      }
      const tag = node.tag.toLowerCase();
      if (
        !node.isComponent &&
        (["h2", "h3"].includes(tag) ||
          (input.template === "doc" && tag === "h1"))
      ) {
        const title = textOf(node).replace(/\s+/g, " ").trim();
        if (title) {
          const bindings = input.identity.bindings.filter(
            (binding) => binding.sourceNode === node.graphKey,
          );
          if (bindings.length !== 1)
            throw Error("Reader template heading identity");
          entries.push({
            level: tag === "h1" ? 1 : tag === "h2" ? 2 : 3,
            title,
            sourceNode: node.graphKey,
            afId: bindings[0]!.afId,
          });
        }
        continue;
      }
      discover(node.children);
    }
  };
  const eligibleTemplate =
    input.chrome && ["doc", "editorial", "plan"].includes(input.template ?? "");
  if (eligibleTemplate) discover(input.analysis.nodes);
  const rail =
    !!eligibleTemplate &&
    (input.template === "doc" ||
      (slides < 2 &&
        !grid &&
        entries.filter((entry) => entry.level === 2).length >= 3));
  const payload = {
    key: input.analysis.key,
    sourceSha256: input.analysis.sourceSha256,
    analysisSha256: input.analysis.analysisSha256,
    documentSha256: input.analysis.documentSha256,
    compilerSourceSha256: input.analysis.compilerSourceSha256,
    identityProofSha256: input.identity.proofSha256,
    sourceRecordSha256: input.sourceRecordSha256,
    template: input.template,
    chrome: input.chrome,
    entries: rail ? entries : [],
    rail,
  };
  return { ...payload, sha256: nativeDigest(payload) };
}
export function verifyNativeReaderTemplate(
  input: NativeReaderTemplateInput,
  receipt: NativeReaderTemplateReceipt,
): boolean {
  try {
    return (
      nativeDigest(prepareNativeReaderTemplate(input)) === nativeDigest(receipt)
    );
  } catch {
    return false;
  }
}
/** Exact column and Contents geometry, independent of a particular captured CSS closure. */
export const NATIVE_READER_TEMPLATE_CSS = `
.mx-doc { flex: 1 1 auto; min-width: 0; container-type: inline-size; overflow-x: clip; }
.mx-doc--document { box-sizing: border-box; width: 100%; max-width: 816px; margin-inline: auto; padding: 48px 24px 96px; overflow-wrap: anywhere; }
:where(.mx-doc--document p:empty) { min-height: 1lh; }
.mx-reading { display: flex; align-items: flex-start; }
.mx-reading--plan { max-width: 1536px; margin-inline: auto; }
.mx-reading--plan > .mx-doc { width: 100%; max-width: 1120px; margin-inline: auto; }
@media (min-width: 1600px) { .mx-reading--plan::after { content: ''; flex: 0 0 208px; } }
.mx-outline {
 position: sticky; top: 0; flex: 0 0 208px; width: 208px; max-height: 100vh;
 overflow-y: auto; overflow-x: hidden; box-sizing: border-box;
 padding: 56px 20px 36px 24px; color: var(--muted-foreground, gray);
 font-family: var(--font-body, ui-sans-serif, system-ui, sans-serif); font-size: 12.5px; line-height: 1.4;
}
.mx-outline-label { margin: 0 0 10px 12px; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; font-family: var(--font-mono, ui-monospace, monospace); }
.mx-outline-row {
 display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
 width: 100%; text-align: left; cursor: pointer; margin: 0; padding: 4px 0 4px 12px;
 border: 0; border-left: 2px solid var(--border, rgba(128,128,128,0.25));
 background: none; color: inherit; font: inherit; overflow: hidden; overflow-wrap: anywhere;
}
.mx-outline-row:hover { color: var(--foreground, canvastext); }
.mx-outline-row[aria-current="true"] { color: var(--foreground, canvastext); border-left-color: var(--primary, currentColor); }
.mx-outline-sub { padding-left: 24px; font-size: 12px; }
:fullscreen .mx-outline { display: none; }
@media (max-width: 1023px) { .mx-outline { display: none; } }
@media print { .mx-outline { display: none; } }
`;
/** Ordinary author DOM behavior: no globals, injected platform state, URL hashes or AST selectors. */
export const NATIVE_CONTENTS_AUTHOR_JS = `
(()=>{
 const root=document.querySelector('[data-af-reader-template]');if(!root)return;
 const win=document.defaultView;if(!win)return;
 const rows=()=>[...root.querySelectorAll('.mx-outline-row[data-af-contents-target]')];
 const heading=row=>{const domId=row.getAttribute('data-af-contents-dom-id');return domId?[...root.querySelectorAll('.mx-doc [id]')].find(node=>node.id===domId):[...root.querySelectorAll('.mx-doc [data-af-id]')].find(node=>node.getAttribute('data-af-id')===row.getAttribute('data-af-contents-target'));};
 const mark=()=>{const list=rows();let active=0;const line=win.innerHeight/3;list.forEach((row,i)=>{const node=heading(row);if(node&&node.getBoundingClientRect().top<=line)active=i;});list.forEach((row,i)=>{if(i===active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});};
 root.addEventListener('click',event=>{const row=event.target?.closest?.('.mx-outline-row[data-af-contents-target]');if(row&&root.contains(row))heading(row)?.scrollIntoView({behavior:'smooth',block:'start'});});
 win.addEventListener('scroll',mark,{passive:true});win.addEventListener('resize',mark);
 let queued=0;new win.MutationObserver(()=>{if(queued)return;queued=win.setTimeout(()=>{queued=0;mark();},16);}).observe(root,{childList:true,subtree:true});mark();
})();`;
export function renderNativeReaderTemplate(
  receipt: NativeReaderTemplateReceipt,
  content: string,
): NativeReaderTemplateOutput {
  const column = `<div class="${receipt.template === "doc" ? "mx-doc mx-doc--document" : "mx-doc"}">${content}</div>`;
  let html = column;
  if (receipt.rail) {
    let section = 0;
    const rows = receipt.entries
      .map((entry) => {
        if (entry.level === 2) section++;
        const label =
          entry.level === 2
            ? `Go to section ${section}: ${entry.title}`
            : `Go to ${entry.title}`;
        return `<button type="button" class="${entry.level === 3 ? "mx-outline-row mx-outline-sub" : "mx-outline-row"}" aria-label="${escape(label)}" data-af-contents-target="${escape(entry.afId)}"${entry.domId ? ` data-af-contents-dom-id="${escape(entry.domId)}"` : ""}>${escape(entry.title)}</button>`;
      })
      .join("");
    html = `<div class="${receipt.template === "plan" ? "mx-reading mx-reading--plan" : "mx-reading"}"><nav class="mx-outline" aria-label="Contents"${receipt.entries.length ? "" : " hidden"}><div class="mx-outline-label">Contents</div>${rows}</nav>${column}</div>`;
  }
  return {
    html: html.replace(">", " data-af-reader-template>"),
    css: NATIVE_READER_TEMPLATE_CSS,
    authorJs: receipt.rail ? NATIVE_CONTENTS_AUTHOR_JS : "",
  };
}
