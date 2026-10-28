/**
 * <af-file-upload>: file chooser/drop zone that uploads to a linked live dataset through the
 *   trusted platform frame; no credentials in page code.
 * Usage: import '@afbin/file-upload';  (registers the tags; this .ts is the readable contract)
 * Props: value (file metadata {ref,name,contentType?,size?}[]), datasetName or dataset attribute,
 *   adapter, accept, multiple, max-files (10), max-bytes (50 MB), label, helper-text, disabled.
 *   adapter.upload(file,{dataset,signal}) returns {ref,url,name,contentType,size,replayed?};
 *   optional adapter.fileUrl resolves previews.
 * Events: af-change (cancelable) with detail {value, reason: 'upload'|'remove'}.
 * Examples:
 *   <link rel="af-dataset" data-af-name="attachments" href="ref:DATASET_ID" data-af-mode="live">
 *   <af-file-upload dataset="attachments" multiple accept="text/plain"></af-file-upload>
 *   import {bindFileUpload} from '@afbin/apollo';
 *   const binding=bindFileUpload(document.querySelector('af-file-upload'),
 *     {helperText:'Or drop files here.'});
 *   // binding.setDisabled(true|false) for your own rules; binding.dispose() when removing it.
 * Gotchas: bindFileUpload disables the chooser while the trusted session loads, when signed out, in
 *   archived/portable readers or when the connection is unavailable, and sets helperText ("Sign in
 *   to upload files."); it does not prove an insert grant. For a custom control,
 *   watchUploadContext(listener) reports {state,scope} and returns {unsubscribe()};
 *   uploadFile(file,{dataset,signal,requestId?}) returns the receipt. The signed-in caller needs
 *   current dataset insert authority; the server rechecks access, provenance, file policy and
 *   grants. Requests are bounded to 50 MB and four pending uploads; accept and limits are browser
 *   guidance. Retry with the same File (or an explicit requestId of 8-120 letters, digits, _ . -)
 *   to recover an uncertain upload; reusing an ID for different bytes conflicts. Removing a
 *   reference does not delete the stored file. Archived readers, portable downloads and raw pages
 *   without the platform frame cannot upload.
 */
import { registerComponent } from './register-component';
import { fileUploadStyles, positiveOr, reconcile, uploadFile, uploadUrl, uploadError,
  previewImage, type AfUploadFile, type AfFileUploadAdapter,
  type AfFileUploadChangeDetail } from './file-upload-model';
export type { AfUploadFile, AfFileUploadAdapter,
  AfFileUploadChangeDetail } from './file-upload-model';
/** Transport, account credentials and dataset access belong exclusively to the author's adapter. */
let nextHelperId=0;
export class AfFileUpload extends HTMLElement {
static observedAttributes = ['dataset', 'label', 'accept', 'multiple', 'max-files', 'max-bytes',
    'disabled', 'helper-text'];
  onChange?: (detail: AfFileUploadChangeDetail) => void; onBusyChange?: (busy: boolean) => void;
  private transport?: AfFileUploadAdapter; private selection: AfUploadFile[] = [];
  private controlled = false; private proposed?: AfUploadFile[];
  // Bumped by cancel(); stale uploads and change events compare against it and stop.
  private generation = 0; private controller?: AbortController; private uploading = false;
  private failures: Array<{ file: File; error: string }> = []; private error = '';
  private shell?: HTMLDivElement; private input?: HTMLInputElement;
  private readonly helperId = `af-upload-help-${++nextHelperId}`;
  /** Ordinary caller-owned helper text, with no authentication semantics. */
  get helperText(): string { return this.getAttribute('helper-text') ?? ''; }
set helperText(value: string) { if(value)this.setAttribute('helper-text',value);
    else this.removeAttribute('helper-text'); }
  get adapter(): AfFileUploadAdapter | undefined { return this.transport; }
set adapter(value: AfFileUploadAdapter | undefined) { this.cancel(); this.transport = value;
    this.render(); }
  get value(): AfUploadFile[] { return this.selection.map(file => ({ ...file })); }
set value(value: readonly AfUploadFile[]) { if (!this.proposed || JSON.stringify(
    value) !== JSON.stringify(this.proposed)) this.cancel(); this.controlled = true;
    this.selection = Array.isArray(value) ? value.map(uploadFile).filter((file):
    file is AfUploadFile => file !== null) : []; this.render(); }
  get busy(): boolean { return this.uploading; }
  // HTMLElement.dataset stays the native DOMStringMap; datasetName is the upload destination.
  get datasetName(): string { return this.getAttribute('dataset') ?? ''; }
  set datasetName(value: string) { this.setAttribute('dataset', value); }
  get multiple(): boolean { return this.hasAttribute('multiple'); }
  set multiple(value: boolean) { this.toggleAttribute('multiple', value); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled', value); }
  connectedCallback(): void {
    for (const key of ['value', 'adapter', 'helperText', 'onChange', 'onBusyChange'] as const) {
if (Object.prototype.hasOwnProperty.call(this, key)) { const value = this[key]; delete (
        this as unknown as Record<string, unknown>)[key]; (this as unknown as Record<string,
        unknown>)[key] = value; }
    }
    this.render();
  }
  disconnectedCallback(): void { this.cancel(); }
  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    // Presentation and picker guidance changes apply to future choices, not active requests.
    if (previous !== next && ['dataset', 'multiple', 'disabled'].includes(name)) this.cancel();
    this.render();
  }
  reset(): void { this.cancel(); this.render(); }
private setBusy(value: boolean): void { if (value !== this.uploading) { this.uploading = value;
    this.onBusyChange?.(value); } }
private cancel(): void { this.generation++; this.controller?.abort(); this.controller = undefined;
    this.failures = []; this.error = ''; this.setBusy(false); }
  private change(value: AfUploadFile[], reason: AfFileUploadChangeDetail['reason']): void {
    const detail = { value: value.map(file => ({ ...file })), reason };
    this.proposed = detail.value; const generation = this.generation;
    try {
if (!this.dispatchEvent(new CustomEvent<AfFileUploadChangeDetail>('af-change', { detail, cancelable:
        true, bubbles: true, composed: true }))) return;
      if (generation !== this.generation) return;
      if (!this.controlled) this.selection = value;
      this.onChange?.(detail);
    } finally { this.proposed = undefined; }
  }
async upload(files: readonly File[], retained: Array<{ file: File; error: string }> = []):
    Promise<void> {
    const adapter = this.adapter;
    if (!this.isConnected || this.disabled || this.busy || !adapter || !files.length) return;
    const positive = (name: string, fallback: number) =>
      positiveOr(this.getAttribute(name), fallback);
    this.error = uploadError(files, this.selection.length, { multiple: this.multiple,
      accept: this.getAttribute('accept') ?? '', maxFiles: positive('max-files', 10),
      maxBytes: positive('max-bytes', 50_000_000) });
    if (this.error) { this.render(); return; }
    const token = ++this.generation; const controller = new AbortController();
    this.controller = controller;
    this.failures = retained; this.setBusy(true); this.render();
    for (const file of files) {
      if (token !== this.generation) break;
      try {
const result = uploadFile(await adapter.upload(file, { dataset: this.datasetName, signal:
          controller.signal }));
        if (!result) throw new Error('Upload adapter returned invalid file metadata.');
        if (token !== this.generation) break;
this.change(this.multiple ? [...this.selection.filter(item => item.ref !== result.ref), result] : [
          result], 'upload');
      } catch (cause) {
        if (token !== this.generation) break;
this.failures.push({ file, error: cause instanceof Error ? cause.message :
          'Upload failed. Try again.' });
      }
      this.render();
    }
    if (token !== this.generation) return;
    this.controller = undefined; this.setBusy(false); this.render();
  }
  private render(): void {
    if (!this.isConnected) return;
if (!this.shell) { this.shell = this.ownerDocument.createElement('div'); this.shell.className =
      'af-file-upload-shell'; this.prepend(this.shell); }
    // Build a fresh tree, then reconcile it into the live shell so focus and rows survive.
    const target = this.shell; this.shell = this.ownerDocument.createElement('div');
    this.shell.className = 'af-file-upload-shell';
    this.setAttribute('aria-busy', String(this.busy));
    const doc = this.ownerDocument;
const add = (tag: string, text = '', parent: HTMLElement = this.shell!) => { const node =
      doc.createElement(tag); node.textContent = text; parent.append(node); return node; };
const label = this.getAttribute('label') || 'Attachments'; add('span', label).className =
      'af-file-upload-label';
    const drop = add('div'); drop.className = 'af-file-upload-drop';
const input = doc.createElement('input'); this.input = input; input.type = 'file'; input.className =
      'af-file-upload-input'; input.tabIndex = -1; input.multiple = this.multiple; input.accept =
      this.getAttribute('accept') ?? ''; input.setAttribute('aria-label', `Choose ${label}`);
      input.setAttribute('aria-describedby', this.helperId); input.disabled = this.disabled ||
      this.busy || !this.adapter; drop.append(input);
const button = (name: string, text: string, action: () => void, parent: HTMLElement) => {
      const node = doc.createElement('button'); node.type = 'button'; node.textContent = text;
      node.setAttribute('aria-label', name); if(name===`Choose ${label}`)node.setAttribute(
      'aria-describedby',this.helperId); node.disabled = this.disabled || this.busy ||
      !this.adapter; node.onclick = action; parent.append(node); return node; };
button(`Choose ${label}`, this.multiple ? 'Choose files' : 'Choose file', () => this.input?.click(),
      drop);
const help = add('span', this.helperText || (this.adapter ? 'Or drop files here.' :
      'Uploads unavailable.'), drop);
    help.id=this.helperId; help.className='af-file-upload-help';
input.onchange = () => { const files = Array.from(this.input?.files ?? []); if (
      this.input) this.input.value = ''; void this.upload(files); };
drop.ondragover = event => event.preventDefault(); drop.ondrop = event => { event.preventDefault();
      void this.upload(Array.from(event.dataTransfer?.files ?? [])); };
if (this.busy) { const status = add('span', 'Uploading…'); status.setAttribute('role', 'status');
      const progress = add('progress'); progress.setAttribute('aria-label', 'Uploading files'); }
    if (this.error) add('p', this.error).setAttribute('role', 'alert');
for (const failure of this.failures) { const row = add('div'); add('span',
      `${failure.file.name}: ${failure.error}`, row).setAttribute('role', 'alert'); button(
      `Retry ${failure.file.name}`, 'Retry', () => { void this.upload([failure.file],
      this.failures.filter(item => item !== failure)); }, row); }
    const list = add('ul'); list.setAttribute('aria-label', `${label} files`);
    for (const file of this.selection) {
      const row = add('li', '', list); row.setAttribute('data-af-upload-ref', file.ref);
      let url: string | undefined;
try { url = uploadUrl(this.adapter?.fileUrl?.(file, this.datasetName), doc.baseURI); } catch {
        /* Preview failure must not prevent reference removal. */ }
    if (url && file.contentType?.startsWith('image/')) row.append(previewImage(doc,url,file.name));
      const details = add('div', '', row); details.className = 'af-file-upload-details';
if (url) { const link = doc.createElement('a'); link.href = url; link.download = file.name;
        link.textContent = file.name; details.append(link); } else add('span', file.name, details);
if (typeof file.size === 'number') add('span', file.size < 1000 ? `${file.size} bytes` : `${(
        file.size / 1_000_000).toFixed(2)} MB`, details).className = 'af-file-upload-size';
button(`Remove ${file.name}`, 'Remove', () => { const focused =
        this.ownerDocument.activeElement?.closest('li')?.getAttribute(
        'data-af-upload-ref') === file.ref; this.cancel(); this.change(this.selection.filter(item =>
        item.ref !== file.ref), 'remove'); this.render(); if (focused) (
        this.shell?.querySelector<HTMLButtonElement>('li button') ??
        this.shell?.querySelector<HTMLButtonElement>('button'))?.focus(); }, row).disabled =
        this.disabled;
    }
    reconcile(target, this.shell); this.shell = target;
    this.input = target.querySelector('input') ?? undefined;
  }
}
registerComponent({
  styleKey: 'af-file-upload-styles',
  styles: fileUploadStyles,
  elements: { 'af-file-upload': AfFileUpload },
});
