/**
 * /files/new — UPLOAD A FILE AND SEE IT, the assets counterpart of /datasets/new.
 *
 * Pick or drop a file and it previews at once from the local bytes, by type:
 * images, video and audio through the browser's own renderers, text as its
 * first lines, fonts as a specimen, glb on a canvas (ModelPreview). A pdf
 * previews the moment it is uploaded, from the stored copy: the app's CSP
 * frames only this origin (server/app, `frame-src 'self'`), and /a/<id>/raw
 * is served inline for exactly this. Types the browser cannot show get a card
 * with an icon, the facts a person picks a file by, and a download. Upload
 * sends the file through the create door's JSON shape — the one shape that
 * carries `parent_id`, so a file picked from inside a folder lands in that
 * folder — choosing the image, pdf or file tier by extension exactly as the
 * CLI does (lib/story/file-types).
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { Box, Check, Copy, Download, File as FileIcon, FileArchive, FileSpreadsheet, FileUp } from 'lucide-react';
import AssetPageHeader from '@/components/AssetPageHeader';
import ModelPreview from '@/components/ModelPreview';
import { Button, Input, LINK } from '@/components/ui';
import { formatFileSize } from '@/lib/file-display';
import { useSearchParams } from '@/lib/navigation';
import { FILE_EXTENSIONS, assetFormatOf, fileContentType } from '@/lib/story/file-types';
import { useSession } from '@/web/session';

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'font' | 'model' | 'other';

/** What the browser can show for each accepted extension; absent means a card. */
const KIND_BY_EXTENSION: Record<string, Kind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  txt: 'text', csv: 'text', json: 'text',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font',
  // A .gltf alone usually points at buffers that are not in the upload; only
  // the self-contained binary previews.
  glb: 'model',
};

const ACCEPT = FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
/** How much of a text file the preview reads: enough to recognise it. */
const TEXT_PREVIEW_BYTES = 8_000;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

const readAs = (file: Blob, mode: 'dataUrl' | 'text') =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });

interface Picked {
  file: File;
  /** An object URL over the local bytes — what every preview renders from. */
  url: string;
  kind: Kind;
  text: string | null;
}

/** The dataset workspace's own control shapes (ui.Button), so the two asset
 * pages read as one: 4px radii, mono, one solid accent. */
const ACTION = 'inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border px-3 py-1.5 font-mono text-xs no-underline transition-colors';

export function FileUploadPage() {
  const { session } = useSession();
  const parentId = useSearchParams().get('parent_id');
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ id: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  // One object URL per pick, released when it is replaced or the page goes.
  useEffect(() => {
    const url = picked?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked?.url]);

  if (session && !session.user) {
    return <Navigate to={`/login?callbackUrl=${encodeURIComponent('/files/new')}`} replace />;
  }

  const pick = async (file: File) => {
    setError('');
    setResult(null);
    setCopied(false);
    if (!assetFormatOf(file.name)) {
      const extension = extensionOf(file.name);
      setError(`${extension ? `.${extension} files are` : 'That file is'} not accepted. Accepted: ${FILE_EXTENSIONS.join(', ')}.`);
      return;
    }
    const kind = KIND_BY_EXTENSION[extensionOf(file.name)] ?? 'other';
    const text = kind === 'text' ? await readAs(file.slice(0, TEXT_PREVIEW_BYTES), 'text').catch(() => null) : null;
    setPicked({ file, url: URL.createObjectURL(file), kind, text });
    setTitle(file.name.replace(/\.[^.]+$/, ''));
  };

  const upload = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await readAs(picked.file, 'dataUrl');
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const contentType = fileContentType(picked.file.name) ?? picked.file.type ?? 'application/octet-stream';
      const door = assetFormatOf(picked.file.name);
      // The content type comes from the NAME, not the browser's guess: the
      // image door checks the data URL's label, and a browser that reports an
      // empty type for a .svg would otherwise have the upload refused.
      const content =
        door === 'image'
          ? { image: `data:${contentType};base64,${base64}` }
          : door === 'pdf'
            ? { pdf: `data:application/pdf;base64,${base64}` }
            : { file: { filename: picked.file.name, contentType, base64 } };
      const response = await fetch('/api/my/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...content, title: title.trim() || picked.file.name, parent_id: parentId }),
      }).catch(() => null);
      if (!response) {
        setError('Upload failed. Check your connection and try again.');
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { id?: string; details?: string[]; maxBytes?: number };
      if (!response.ok || !data.id) {
        setError(
          response.status === 413
            ? `That file is too large${data.maxBytes ? ` (the limit is ${formatFileSize(data.maxBytes)})` : ''}.`
            : data.details?.[0] ?? (response.status === 403 ? 'You have reached your limit.' : 'Could not upload that file.'),
        );
        return;
      }
      setResult({ id: data.id });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPicked(null);
    setTitle('');
    setResult(null);
    setError('');
    setCopied(false);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void pick(file);
  };

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <AssetPageHeader
        icon={FileUp}
        eyebrow="Asset upload"
        title="Upload a file"
        link={{ href: '/assets', label: 'Back to assets', text: 'all assets' }}
      />

      <div className="mx-auto max-w-4xl space-y-6">
        <section aria-label="Upload a file" className="rounded-xl border border-edge bg-surface p-5">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            aria-label="Choose a file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void pick(file);
            }}
          />

          {!picked ? (
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex h-56 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-colors ${
                dragging ? 'border-accent bg-accent-soft' : 'border-edge-bright bg-raised/40 hover:border-accent'
              }`}
            >
              <FileUp aria-hidden="true" size={24} strokeWidth={1.6} className="text-accent" />
              <span className="text-sm text-fg">Drop a file here, or click to choose one</span>
              <span className="text-xs text-muted">Images, pdf, video, audio, text, fonts and glb models</span>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 truncate font-medium text-fg">{picked.file.name}</span>
                <span className="text-xs text-muted">{formatFileSize(picked.file.size)}</span>
                {!result && (
                  <button type="button" onClick={() => input.current?.click()} className={`ml-auto cursor-pointer font-mono text-xs ${LINK}`}>
                    choose another
                  </button>
                )}
              </div>

              <div className="mt-4">
                <Preview picked={picked} storedUrl={result ? `/a/${result.id}/raw` : null} />
              </div>

              {result ? (
                <div aria-label="Uploaded file" className="mt-5 rounded-lg border border-edge bg-raised/40 p-4">
                  <p className="flex items-center gap-2 text-sm text-fg">
                    <Check aria-hidden="true" size={15} className="text-accent" />
                    Uploaded as <span className="font-medium">{title.trim() || picked.file.name}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={`/a/${result.id}`} aria-label="Open artifact" className={`${ACTION} border-accent bg-accent font-semibold text-bg hover:brightness-110`}>
                      Open artifact →
                    </a>
                    <button
                      type="button"
                      aria-label="Copy file reference"
                      onClick={() => { void navigator.clipboard?.writeText(`ref:${result.id}`); setCopied(true); }}
                      className={`${ACTION} border-edge-bright bg-surface text-accent hover:border-accent`}
                    >
                      ref:{result.id}
                      {copied ? <Check aria-hidden="true" size={12} /> : <Copy aria-hidden="true" size={12} />}
                    </button>
                    <Button variant="ghost" type="button" onClick={reset}>
                      Upload another
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap items-end gap-3">
                  <label className="grid min-w-48 flex-1 gap-1.5 text-xs text-muted">
                    Title
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={picked.file.name} />
                  </label>
                  <Button type="button" onClick={() => void upload()} disabled={busy} className="inline-flex items-center gap-1.5 py-2">
                    <FileUp aria-hidden="true" size={13} />
                    {busy ? 'Uploading…' : 'Upload'}
                  </Button>
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function Preview({ picked, storedUrl }: { picked: Picked; storedUrl: string | null }) {
  const { file, url, kind, text } = picked;
  switch (kind) {
    case 'image':
      // eslint-disable-next-line @next/next/no-img-element -- a local object URL; no optimizer.
      return <img src={url} alt={file.name} className="max-h-[28rem] max-w-full rounded-lg border border-edge" />;
    case 'pdf':
      return storedUrl ? (
        <iframe src={storedUrl} title={file.name} className="h-[32rem] w-full rounded-lg border border-edge bg-surface" />
      ) : (
        <DownloadCard file={file} url={url} note="previews once uploaded" />
      );
    case 'video':
      return <video src={url} controls aria-label={file.name} className="max-h-[28rem] w-full rounded-lg border border-edge bg-black" />;
    case 'audio':
      return <audio src={url} controls aria-label={file.name} className="w-full" />;
    case 'text':
      return (
        <pre aria-label={`Preview of ${file.name}`} className="max-h-[28rem] overflow-auto rounded-lg border border-code-edge bg-code p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg">
          {text ?? ''}
          {text !== null && file.size > TEXT_PREVIEW_BYTES ? '\n…' : ''}
        </pre>
      );
    case 'font':
      return <FontPreview key={url} file={file} name={file.name} />;
    case 'model':
      return <ModelPreview source={file} title={file.name} />;
    default:
      return <DownloadCard file={file} url={storedUrl ?? url} note="no preview for this type" />;
  }
}

/** A specimen set in the uploaded face, through the FontFace API — from the
 * bytes, because `font-src` (server/app) admits no blob: URL. */
function FontPreview({ file, name }: { file: Blob; name: string }) {
  const [family] = useState(() => `mx-preview-${Math.random().toString(36).slice(2, 8)}`);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (typeof FontFace === 'undefined') {
      setState('error');
      return;
    }
    let cancelled = false;
    let face: FontFace | null = null;
    file
      .arrayBuffer()
      .then((bytes) => {
        face = new FontFace(family, bytes);
        return face.load();
      })
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
      if (face) document.fonts.delete(face);
    };
  }, [family, file]);
  return (
    <div aria-label={`Font preview of ${name}`} className="rounded-lg border border-edge bg-raised/40 p-6" style={state === 'ready' ? { fontFamily: `'${family}', sans-serif` } : undefined}>
      <p className="text-3xl leading-tight text-fg">The quick brown fox jumps over the lazy dog</p>
      <p className="mt-2 text-base text-muted">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</p>
      {state !== 'ready' && (
        <p className="mt-3 font-mono text-[10px] text-faint">{state === 'loading' ? 'loading font…' : 'this font could not be loaded for preview'}</p>
      )}
    </div>
  );
}

/** The card for a type the browser cannot show: an icon that says what it is,
 * the two facts a person picks a file by, and the download. */
function DownloadCard({ file, url, note }: { file: File; url: string; note: string }) {
  const extension = extensionOf(file.name);
  const Icon = ['gltf', 'obj', 'fbx', 'stl'].includes(extension) ? Box : extension === 'xlsx' ? FileSpreadsheet : extension === 'zip' ? FileArchive : FileIcon;
  return (
    <div aria-label={`File summary of ${file.name}`} className="flex items-center gap-4 rounded-lg border border-edge bg-raised/40 p-5">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-edge bg-surface text-accent">
        <Icon aria-hidden="true" size={26} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{file.name}</p>
        <p className="mt-0.5 text-xs text-muted">.{extension} · {formatFileSize(file.size)} · {note}</p>
      </div>
      <a href={url} download={file.name} aria-label={`Download ${file.name}`} className={`${ACTION} border-edge-bright text-fg hover:border-accent hover:text-accent`}>
        <Download aria-hidden="true" size={13} />
        Download
      </a>
    </div>
  );
}
