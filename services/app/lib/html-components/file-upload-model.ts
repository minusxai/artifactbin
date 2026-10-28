/**
 * Internal: upload policy checks, metadata/URL sanitising, light-DOM reconcile and styles for
 * af-file-upload. Used by: file-upload.ts.
 */
/** Upload policy is browser guidance; the injected adapter enforces authorization and bytes. */
export interface AfUploadFile { ref: string; name: string; contentType?: string; size?: number }
interface AfUploadContext { dataset: string; signal: AbortSignal }
export interface AfFileUploadAdapter {
  upload(file: File, context: AfUploadContext): Promise<AfUploadFile>;
  fileUrl?(file: AfUploadFile, dataset: string): string;
}
export interface AfFileUploadChangeDetail { value: AfUploadFile[]; reason: 'upload' | 'remove' }
export interface AfUploadPolicy { multiple: boolean; accept: string; maxFiles: number; maxBytes:
  number }
export function uploadError(files: readonly File[], selected: number, policy: AfUploadPolicy):
  string {
  const limit = policy.multiple ? Math.max(1, Math.floor(policy.maxFiles)) : 1;
if (files.length + (policy.multiple ? selected :
    0) > limit) return `Choose at most ${limit} file${limit === 1 ? '' : 's'}.`;
  const rules = policy.accept.toLowerCase().split(',').map(rule => rule.trim()).filter(Boolean);
  for (const file of files) {
    if (file.size > policy.maxBytes) {
      return `${file.name} exceeds the ${policy.maxBytes / 1_000_000} MB limit.`;
    }
if (rules.length && !rules.some(rule => rule.startsWith('.') ? file.name.toLowerCase().endsWith(
      rule) : rule.endsWith('/*') ? file.type.toLowerCase().startsWith(rule.slice(0, -1)) :
      file.type.toLowerCase() === rule)) return `${file.name} is not an accepted file type.`;
  }
  return '';
}
/** Copy only recognized metadata; transport responses and runtime author values are untrusted. */
export function uploadFile(value: unknown): AfUploadFile | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
if (typeof item.ref !== 'string' || !item.ref.trim() || typeof item.name !== 'string' ||
    !item.name.trim()) return null;
return { ref: item.ref, name: item.name, ...(typeof item.contentType === 'string' ? { contentType:
    item.contentType } : {}), ...(typeof item.size === 'number' && Number.isFinite(item.size) &&
    item.size >= 0 ? { size: item.size } : {}) };
}
/** A positive finite number from an attribute value, else the fallback. */
export function positiveOr(raw: string | null, fallback: number): number {
  const value = Number(raw); return Number.isFinite(value) && value > 0 ? value : fallback;
}
export function uploadUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) &&
    !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
/** Lazy thumbnail that removes itself if the image fails to load. */
export function previewImage(doc: Document, url: string, name: string): HTMLImageElement {
  const image = doc.createElement('img');
  image.src = url; image.alt = name; image.loading = 'lazy'; image.onerror = event => {
    if (typeof event !== 'string') (event.currentTarget as HTMLImageElement).remove(); };
  return image;
}
/** Reconcile generated light DOM without replacing focused controls or keyed file rows. */
export function reconcile(target: HTMLElement, source: HTMLElement): void {
for (const attribute of Array.from(target.attributes)) if (!source.hasAttribute(attribute.name) &&
    attribute.name !== 'data-af-id') target.removeAttribute(attribute.name);
for (const attribute of Array.from(source.attributes)) target.setAttribute(attribute.name,
    attribute.value);
target.onerror = source.onerror; target.onclick = source.onclick; target.onchange = source.onchange;
    target.ondrop = source.ondrop; target.ondragover = source.ondragover;
if (target instanceof HTMLButtonElement && source instanceof HTMLButtonElement) target.disabled =
    source.disabled;
if (target instanceof HTMLInputElement && source instanceof HTMLInputElement) { target.disabled =
    source.disabled; target.multiple = source.multiple; }
  const previous = Array.from(target.childNodes);
  const used = new Set<Node>();
const key = (node: HTMLElement) => node.getAttribute('data-af-upload-ref') ??
    `${node.tagName}:${node.className}:${node.getAttribute('role') ?? ''}`;
  let index = 0;
  for (const next of Array.from(source.childNodes)) {
const existing = previous.find(node => !used.has(node) && (node instanceof HTMLElement &&
      next instanceof HTMLElement ? key(node) === key(next) : node.nodeType === next.nodeType));
    if (existing) used.add(existing);
if (existing instanceof HTMLElement && next instanceof HTMLElement &&
      existing.tagName === next.tagName) {
      reconcile(existing, next);
if (target.childNodes[index] !== existing) target.insertBefore(existing, target.childNodes[index] ??
        null);
} else if (existing?.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
      existing.textContent = next.textContent; }
    else target.insertBefore(next, target.childNodes[index] ?? null);
    index++;
  }
  while (target.childNodes.length > index) target.lastChild?.remove();
}
export const fileUploadStyles =
  'af-file-upload{display:block;color:var(--foreground,#222)}' +
  'af-file-upload .af-file-upload-input{position:absolute;width:1px;height:1px;padding:0;' +
  'margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
  'af-file-upload .af-file-upload-shell{display:flex;flex-direction:column;gap:.75rem}' +
  'af-file-upload .af-file-upload-label{font-size:.875rem;font-weight:500;line-height:1.25rem}' +
  'af-file-upload .af-file-upload-drop{display:flex;flex-direction:column;align-items:flex-start;' +
  'gap:.5rem;border:1px dashed var(--input,#aaa);padding:1rem;border-radius:var(--radius-md,' +
  'calc(var(--radius,.625rem) - 2px))}' +
  'af-file-upload .af-file-upload-help{font-size:.75rem;color:var(--muted-foreground,#666)}' +
  'af-file-upload button{font:inherit;font-size:.875rem;line-height:1.25rem;color:inherit;' +
  'background:var(--background,#fff);border:1px solid var(--input,#aaa);' +
  'border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:.5rem .75rem;' +
  'box-shadow:0 1px 2px #0000000d;cursor:pointer}' +
  'af-file-upload button:focus-visible{outline:2px solid var(--ring,#777);outline-offset:2px}' +
  'af-file-upload button:disabled{opacity:.5;cursor:not-allowed}' +
  'af-file-upload li{display:flex;gap:.5rem;align-items:center}' +
  'af-file-upload .af-file-upload-details{display:flex;min-width:0;flex:1;flex-direction:column}' +
  'af-file-upload .af-file-upload-details a{overflow:hidden;text-overflow:ellipsis;' +
  'white-space:nowrap}' +
  'af-file-upload .af-file-upload-size{font-size:.75rem;color:var(--muted-foreground,#666)}' +
  'af-file-upload img{border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));' +
  'width:4rem;height:4rem;object-fit:cover}' +
  'af-file-upload [role=alert]{color:var(--destructive,#b11)}';
