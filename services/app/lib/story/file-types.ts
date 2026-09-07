/** Accepted generic uploads and the MIME type served for each final extension. */
export const FILE_TYPES = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', fbx: 'application/octet-stream', stl: 'model/stl',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  zip: 'application/zip',
} as const;

export const FILE_EXTENSIONS = Object.keys(FILE_TYPES);

export function fileContentType(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, extension)
    ? FILE_TYPES[extension as keyof typeof FILE_TYPES] : null;
}
