/** Accepted generic uploads and the MIME type served for each final extension. */
const FILE_TYPES = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', fbx: 'application/octet-stream', stl: 'model/stl',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  zip: 'application/zip',
} as const;

export const FILE_EXTENSIONS = Object.keys(FILE_TYPES);

/** The lower-cased final extension, or null when the name has none. */
function finalExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? null : filename.slice(dot + 1).toLowerCase();
}

export function fileContentType(filename: string): string | null {
  const extension = finalExtension(filename);
  return extension !== null && Object.prototype.hasOwnProperty.call(FILE_TYPES, extension)
    ? FILE_TYPES[extension as keyof typeof FILE_TYPES] : null;
}

/**
 * The extensions that go through the IMAGE door — sniffed, re-encoded to webp,
 * measured, given a narrow variant.
 *
 * This is exactly what {@link IMAGE_CONTENT_TYPES} (lib/story/image-store)
 * accepts, and it has to stay exactly that. `avif` is the interesting absence:
 * it is a perfectly good {@link FILE_TYPES} upload and the browser renders it,
 * but the image door refuses those bytes, so calling one an `image` here would
 * have preflight validate a document against a tier the upload would then be
 * rejected from — and, worse, would have the declared format disagree with the
 * artifact the CLI actually creates, so its hash could never match on the next
 * push. An avif is a `file`, the same thing the create body already makes it.
 */
const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

/**
 * WHICH ASSET TIER A LOCAL FILE BELONGS TO, decided from its name alone — the
 * ONE rule the CLI and the server both speak.
 *
 * Preflight describes a local asset by HASH rather than by bytes, so the server
 * never sees the file it is validating a document against: the extension is all
 * there is to decide whether `ref:local000001` may sit in an `<img>`, a `<File>`
 * or an `<a>`. The CLI imports this same function to choose the upload door for
 * a miss, which is what stops the format preflight promised and the format the
 * upload actually produces from drifting apart.
 *
 * Null for anything outside {@link FILE_TYPES}: an extension no door here
 * accepts is not a dependency, it is a typo or an attempt.
 */
export function assetFormatOf(filename: string): 'image' | 'pdf' | 'file' | null {
  const extension = finalExtension(filename);
  if (extension === null || !Object.prototype.hasOwnProperty.call(FILE_TYPES, extension)) return null;
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  return extension === 'pdf' ? 'pdf' : 'file';
}
