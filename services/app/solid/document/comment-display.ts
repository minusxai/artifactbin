/**
 * HOW COMMENT BODIES ARE READ: lib/markdown's display entry (parse, the one HTML writer, plain text), loaded as a
 * chunk of its own the first time a body or a preview is shown, so the comment UI that only lists threads never
 * carries the parser. `commentDisplay()` is a Solid signal read: whatever reads it (a thread body, a preview) renders
 * again once the chunk has arrived, and the first read starts the load.
 *
 * Comment rules on top of the module's: person and agent-session mention links are classified (`data-mx-link`
 * `person` / `session`) so the thread hydrates them into its mention components; an image is shown through the
 * document's first-view asset route (`/a/<document>/assets?u=<src>`, same-origin, read access checked there), an
 * upload `ref:<id>` at `/a/<id>/raw`. Without a document to route through, image syntax shows as typed.
 */
import { createContext, createSignal } from 'solid-js';
import type * as Display from '@/lib/markdown/display';
import { ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts/artifact-reference';
import { isSessionMentionHref } from '@/lib/annotations/session-mentions';
import { isPersonMentionHref } from '@/lib/document/person-mentions';

type DisplayModule = typeof Display;

/** The document whose comments these are: where their images are fetched through. */
export const CommentDocument = createContext<string | undefined>(undefined);

const [display, setDisplay] = createSignal<DisplayModule>();
let loading: Promise<DisplayModule> | undefined;

/** Load the display chunk now (a caller that knows a body is coming, and tests). */
export function loadCommentDisplay(): Promise<DisplayModule> {
  loading ??= import('@/lib/markdown/display').then(
    (module) => { setDisplay(() => module); return module; },
    (error: unknown) => { loading = undefined; throw error; },
  );
  return loading;
}

/** The display entry once loaded, else undefined (and the load starts): a tracked read. */
export function commentDisplay(): DisplayModule | undefined {
  const module = display();
  if (!module) loadCommentDisplay().catch(() => {});
  return module;
}

/** `person` for a person mention, `session` for an agent-session mention, else null. */
const classifyCommentLink = (href: string): 'person' | 'session' | null =>
  isPersonMentionHref(href) ? 'person' : isSessionMentionHref(href) ? 'session' : null;

/** An upload's own address (`ref:<id>` → `/a/<id>/raw`), or null for any other source. */
export const uploadAddress = (src: string): string | null => {
  const upload = ARTIFACT_REFERENCE_PATTERN.exec(src)?.[1];
  return upload ? `/a/${upload}/raw` : null;
};
/** Where a comment image's source is shown from, for the document `artifactId`. */
export const commentImageAddress = (artifactId: string) => (src: string): string =>
  uploadAddress(src) ?? `/a/${encodeURIComponent(artifactId)}/assets?u=${encodeURIComponent(src)}`;

/** A body as the shared markup, or null while the display chunk loads. */
export function commentHtml(body: string, artifactId: string | undefined): string | null {
  const module = commentDisplay();
  if (!module) return null;
  const doc = module.parse(body, { images: artifactId !== undefined });
  return module.renderHtml(doc, { classifyLink: classifyCommentLink, imageAddress: artifactId === undefined ? undefined : commentImageAddress(artifactId) });
}

/** A body with its markup taken off, for the compact surfaces; '' while the display chunk loads. */
export function commentPlainText(body: string): string {
  const module = commentDisplay();
  return module ? module.plainText(module.parse(body, { images: true })) : '';
}
