import { uploadError, type AfUploadFile, type AfFileUploadAdapter, type AfFileUploadChangeDetail } from './file-upload-model';
export type { AfUploadFile, AfFileUploadAdapter, AfFileUploadChangeDetail } from './file-upload-model';

/** Transport, account credentials and dataset access belong exclusively to the author's adapter. */
export class AfFileUpload extends HTMLElement {
  static observedAttributes = ['dataset', 'label', 'accept', 'multiple', 'max-files', 'max-bytes', 'disabled'];
  onChange?: (detail: AfFileUploadChangeDetail) => void;
  onBusyChange?: (busy: boolean) => void;
  private transport?: AfFileUploadAdapter;
  private selection: AfUploadFile[] = [];
  private controlled = false;
  private proposed?: AfUploadFile[];
  private generation = 0;
  private controller?: AbortController;
  private uploading = false;
  private failures: Array<{ file: File; error: string }> = [];
  private error = '';
  private shell?: HTMLDivElement;
  private input?: HTMLInputElement;
  get adapter(): AfFileUploadAdapter | undefined { return this.transport; }
  set adapter(value: AfFileUploadAdapter | undefined) { this.cancel(); this.transport = value; this.render(); }
  get value(): AfUploadFile[] { return this.selection.map(file => ({ ...file })); }
  set value(value: readonly AfUploadFile[]) { if (!this.proposed || JSON.stringify(value) !== JSON.stringify(this.proposed)) this.cancel(); this.controlled = true; this.selection = value.map(file => ({ ...file })); this.render(); }
  get busy(): boolean { return this.uploading; }
  // HTMLElement.dataset remains the native DOMStringMap; use datasetName for the upload destination.
  get datasetName(): string { return this.getAttribute('dataset') ?? ''; }
  set datasetName(value: string) { this.setAttribute('dataset', value); }
  get multiple(): boolean { return this.hasAttribute('multiple'); }
  set multiple(value: boolean) { this.toggleAttribute('multiple', value); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled', value); }
  connectedCallback(): void {
    for (const key of ['value', 'adapter', 'onChange', 'onBusyChange'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, key)) { const value = this[key]; delete (this as unknown as Record<string, unknown>)[key]; (this as unknown as Record<string, unknown>)[key] = value; }
    }
    this.render();
  }
  disconnectedCallback(): void { this.cancel(); }
  attributeChangedCallback(): void { this.cancel(); this.render(); }
  reset(): void { this.cancel(); this.render(); }
  private setBusy(value: boolean): void { if (value !== this.uploading) { this.uploading = value; this.onBusyChange?.(value); } }
  private cancel(): void { this.generation++; this.controller?.abort(); this.controller = undefined; this.failures = []; this.error = ''; this.setBusy(false); }
  private change(value: AfUploadFile[], reason: AfFileUploadChangeDetail['reason']): void {
    const detail = { value: value.map(file => ({ ...file })), reason };
    if (!this.dispatchEvent(new CustomEvent<AfFileUploadChangeDetail>('af-change', { detail, cancelable: true, bubbles: true, composed: true }))) return;
    if (!this.controlled) this.selection = value;
    this.proposed = detail.value;
    try { this.onChange?.(detail); } finally { this.proposed = undefined; }
  }
  async upload(files: readonly File[], retained: Array<{ file: File; error: string }> = []): Promise<void> {
    const adapter = this.adapter;
    if (!this.isConnected || this.disabled || this.busy || !adapter || !files.length) return;
    const positive = (name: string, fallback: number) => { const value = Number(this.getAttribute(name)); return Number.isFinite(value) && value > 0 ? value : fallback; };
    this.error = uploadError(files, this.selection.length, { multiple: this.multiple, accept: this.getAttribute('accept') ?? '', maxFiles: positive('max-files', 10), maxBytes: positive('max-bytes', 50_000_000) });
    if (this.error) { this.render(); return; }
    const token = ++this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.failures = retained; this.setBusy(true); this.render();
    for (const file of files) {
      if (token !== this.generation) break;
      try {
        const result = await adapter.upload(file, { dataset: this.datasetName, signal: controller.signal });
        if (token !== this.generation) break;
        this.change(this.multiple ? [...this.selection.filter(item => item.ref !== result.ref), result] : [result], 'upload');
      } catch (cause) {
        if (token !== this.generation) break;
        this.failures.push({ file, error: cause instanceof Error ? cause.message : 'Upload failed. Try again.' });
      }
      this.render();
    }
    if (token === this.generation) { this.controller = undefined; this.setBusy(false); this.render(); }
  }
  private render(): void {
    if (!this.isConnected) return;
    if (!this.shell) { this.shell = this.ownerDocument.createElement('div'); this.shell.className = 'af-file-upload-shell'; this.prepend(this.shell); }
    this.shell.replaceChildren(); this.setAttribute('aria-busy', String(this.busy));
    const doc = this.ownerDocument;
    const add = (tag: string, text = '', parent: HTMLElement = this.shell!) => { const node = doc.createElement(tag); node.textContent = text; parent.append(node); return node; };
    const label = this.getAttribute('label') || 'Attachments'; add('span', label);
    const drop = add('div'); drop.className = 'af-file-upload-drop';
    const input = doc.createElement('input'); this.input = input; input.type = 'file'; input.hidden = true; input.multiple = this.multiple; input.accept = this.getAttribute('accept') ?? ''; input.setAttribute('aria-label', `Choose ${label}`); input.disabled = this.disabled || this.busy || !this.adapter; drop.append(input);
    const button = (name: string, text: string, action: () => void, parent: HTMLElement) => { const node = doc.createElement('button'); node.type = 'button'; node.textContent = text; node.setAttribute('aria-label', name); node.disabled = this.disabled || this.busy || !this.adapter; node.onclick = action; parent.append(node); return node; };
    button(`Choose ${label}`, this.multiple ? 'Choose files' : 'Choose file', () => this.input?.click(), drop);
    add('span', this.adapter ? 'Or drop files here.' : 'Uploads unavailable.', drop);
    input.onchange = () => { const files = Array.from(input.files ?? []); input.value = ''; void this.upload(files); };
    drop.ondragover = event => event.preventDefault(); drop.ondrop = event => { event.preventDefault(); void this.upload(Array.from(event.dataTransfer?.files ?? [])); };
    if (this.busy) { const status = add('span', 'Uploading…'); status.setAttribute('role', 'status'); const progress = add('progress'); progress.setAttribute('aria-label', 'Uploading files'); }
    if (this.error) add('p', this.error).setAttribute('role', 'alert');
    for (const failure of this.failures) { const row = add('div'); add('span', `${failure.file.name}: ${failure.error}`, row).setAttribute('role', 'alert'); button(`Retry ${failure.file.name}`, 'Retry', () => { void this.upload([failure.file], this.failures.filter(item => item !== failure)); }, row); }
    const list = add('ul'); list.setAttribute('aria-label', `${label} files`);
    for (const file of this.selection) {
      const row = add('li', '', list); const url = this.adapter?.fileUrl?.(file, this.datasetName);
      if (url && file.contentType?.startsWith('image/')) { const image = doc.createElement('img'); image.src = url; image.alt = file.name; image.loading = 'lazy'; image.onerror = () => image.remove(); row.append(image); }
      if (url) { const link = doc.createElement('a'); link.href = url; link.download = file.name; link.textContent = file.name; row.append(link); } else add('span', file.name, row);
      button(`Remove ${file.name}`, 'Remove', () => { this.cancel(); this.change(this.selection.filter(item => item.ref !== file.ref), 'remove'); this.render(); }, row).disabled = this.disabled;
    }
  }
}
export function registerFileUpload(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-file-upload-styles]')) { const style = document.createElement('style'); style.setAttribute('data-af-file-upload-styles', ''); style.textContent = 'af-file-upload{display:block;color:var(--foreground,#222)}af-file-upload .af-file-upload-shell{display:flex;flex-direction:column;gap:.75rem}af-file-upload .af-file-upload-drop{display:flex;align-items:center;gap:.5rem;border:1px dashed var(--input,#aaa);padding:1rem;border-radius:var(--radius,.375rem)}af-file-upload button{font:inherit;color:inherit;background:var(--background,#fff);border:1px solid var(--input,#aaa);border-radius:var(--radius,.375rem);padding:.4rem .7rem;cursor:pointer}af-file-upload button:focus-visible{outline:2px solid var(--ring,#777);outline-offset:2px}af-file-upload button:disabled{opacity:.5;cursor:not-allowed}af-file-upload li{display:flex;gap:.5rem;align-items:center}af-file-upload img{width:4rem;height:4rem;object-fit:cover}af-file-upload [role=alert]{color:var(--destructive,#b11)}'; document.head.append(style); }
  if (!registry.get('af-file-upload')) registry.define('af-file-upload', AfFileUpload);
}
