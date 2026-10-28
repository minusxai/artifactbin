import type { LocalPublicationBody, LocalPublicationInput, LocalSelectedFile } from './contracts';

const FILE_LIMIT = 4_000_000, TOTAL_LIMIT = 16_000_000, COUNT_LIMIT = 99;
/** No absolute filesystem paths, traversal, URL credentials or aliases in a publication bundle. */
export function localPublicationPath(input: string): string {
  if (!input || input.startsWith('/') || input.includes('\\') || /[\x00-\x1f?#:]/.test(input)) throw new Error('Choose files using relative project paths.');
  const parts = input.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Choose files using relative project paths.');
  return input;
}
export function publicationBody(input: LocalPublicationInput): LocalPublicationBody {
  const entryPath = localPublicationPath(input.entryPath);
  if (!/\.html?$/i.test(entryPath) || !input.html.trim()) throw new Error('Choose a non-empty HTML source file.');
  const paths = new Set<string>();
  const files = input.files.filter(file => file.path !== entryPath);
  if (files.length > COUNT_LIMIT) throw new Error('Choose at most 99 dependency files.');
  let total = new TextEncoder().encode(input.html).byteLength;
  if (total > FILE_LIMIT) throw new Error('The HTML source must be at most 4 MB.');
  const encoded = files.map(file => {
    const path = localPublicationPath(file.path);
    if (paths.has(path)) throw new Error(`More than one selected file has the path ${path}. Choose its project folder to preserve paths.`);
    paths.add(path);
    if (file.bytes.byteLength > FILE_LIMIT) throw new Error(`The selected file ${path} exceeds 4 MB.`);
    total += file.bytes.byteLength;
    if (total > TOTAL_LIMIT) throw new Error('The selected files exceed 16 MB.');
    let binary = '';
    for (let i = 0; i < file.bytes.length; i += 8192) binary += String.fromCharCode(...file.bytes.subarray(i, i + 8192));
    return { path, contentType: file.contentType || 'application/octet-stream', base64: btoa(binary) };
  });
  return { html: input.html, ...(input.title?.trim() ? { title: input.title.trim() } : {}), visibility: 'private', publicationBundle: { entryPath, files: encoded } };
}
/** A folder picker grants only these files; remove its common selection-root name. */
export async function readSelectedLocalFiles(files: readonly File[]): Promise<LocalSelectedFile[]> {
  if (files.length > COUNT_LIMIT + 1) throw new Error('Choose at most 100 files including the HTML source.');
  if (files.some(file => file.size > FILE_LIMIT) || files.reduce((sum, file) => sum + file.size, 0) > TOTAL_LIMIT) throw new Error('Choose files up to 4 MB each and 16 MB in total.');
  return Promise.all(files.map(async file => {
    const relative = file.webkitRelativePath;
    const path = localPublicationPath(relative ? relative.split('/').slice(1).join('/') : file.name);
    return { path, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type || 'application/octet-stream' };
  }));
}
