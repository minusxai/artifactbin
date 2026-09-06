import {catalogOf} from '@/lib/datasets/catalog';
/**
 * The owner/editor SHELL's props for one document — everything ArtifactDocument
 * used to compute on the server: the ACL (uniform 404), the exporter's signed
 * key, the canonical address (the client heals to it), the viewer's role and
 * session kind, and ArtifactSurface's props (compiled CSS, design, the
 * server-run dataflow, the open-annotation count).
 */
import { countOpenAnnotations } from '@/lib/annotations';
import { canReadArtifact, declarationsForRow, getArtifactById } from '@/lib/artifacts';
import { folderPageFor } from '@/lib/folders';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { verifyExportKey } from '@/lib/export-key';
import { json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { count, has } from '@/lib/relations';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { ARTIFACT_FORMATS, type ArtifactFormat } from '@/lib/story/input';
import { canonicalArtifactPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';
import { browserSessionKind, roleFor, sessionActor } from '@/lib/viewer';
import { accountWorkspaceFor } from '@/lib/workspace';
import { canAnnotate } from '@/lib/share-roles';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const notFound = () => json({ error: 'not_found' }, 404);
  if (!ID_RE.test(id)) return notFound();
  const artifact = await getArtifactById(id);
  if (!artifact) return notFound();
  const search = new URL(request.url).searchParams;
  const key = search.get('key');
  const exporting = verifyExportKey(artifact.id, key ?? undefined);
  const actor = await sessionActor(request);
  if (!exporting && !(await canReadArtifact(artifact, actor.viewer))) return notFound();
  if (!ARTIFACT_FORMATS.includes(artifact.format as ArtifactFormat)) return notFound();

  const role = await roleFor(artifact, actor);
  const kind = await browserSessionKind(request);

  /*
   * A FOLDER IS A LISTING, NOT A DOCUMENT — so its page is answered HERE and
   * carries no `surface` at all.
   *
   * Measured on production while a folder was a document: shell HTML 0.25 s,
   * the frame's document 0.98 s, the sandboxed runtime booted 2.59 s, the
   * children query answered 2.86 s — with the server idle for all of it (the
   * query is ~50 ms). The listing was last because it was authored markup
   * inside an opaque origin that cannot cache the runtime it needed. It is app
   * data now: computed once here, inlined into the HTML by `withBootstrap`, so
   * the rows are in the first byte and the first paint is the final geometry.
   *
   * Above every `isDoc` branch below, because none of them applies: there is no
   * source to compile a sheet for, no declarations to seed, no annotations to
   * count and nothing to frame.
   */
  if (artifact.format === 'folder') {
    const handle = await ownerUsername(artifact.user_id);
    const [folder, workspace] = await Promise.all([
      folderPageFor(artifact, { userId: actor.viewer?.userId ?? null, email: actor.viewer?.email ?? null, tokenId: actor.tokenId ?? null }),
      role === 'owner' && actor.viewer?.userId
        ? accountWorkspaceFor(actor.viewer.userId, actor.viewer.email)
        : Promise.resolve(null),
    ]);
    return json({
      canonical: canonicalArtifactPath(artifact, handle),
      ownerUsername: handle,
      role,
      kind,
      // The TOKEN travels beside the account, as everywhere the folder ACL is
      // asked: an unclaimed folder is owned by the token that made it, and the
      // account viewer alone would answer its own owner a stranger's shelf.
      folder,
      ...(workspace ? { workspace } : {}),
    }, 200, { 'Cache-Control': 'no-store' });
  }

  const meta = (artifact.meta ?? {}) as {
    theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const isDoc = artifact.format === 'markup';
  // The heart renders from THIS answer: asking a second door for it would
  // leave the control blank (or wrong) for a frame on every page load. An
  // anonymous reader still gets the count — it is the number, not the button,
  // that everyone can see.
  const viewerId = actor.viewer?.userId ?? null;
  return json({
    canonical: canonicalArtifactPath(artifact, await ownerUsername(artifact.user_id)),
    role,
    kind,
    like: { liked: viewerId ? await has(viewerId, 'like', artifact.id) : false, count: await count('like', artifact.id) },
    // The follow control is keyed by the AUTHOR's id. Null for an anonymous
    // document, and for the owner, who has nobody here to follow.
    follow: artifact.user_id && artifact.user_id !== viewerId
      ? { userId: artifact.user_id, following: viewerId ? await has(viewerId, 'follow', artifact.user_id) : false, count: await count('follow', artifact.user_id) }
      : null,
    surface: {
      captureKey: exporting ? key : null,
      id: artifact.id,
      editId: artifact.edit_id,
      format: artifact.format,
      title: artifact.title,
      source: artifact.source,
      content: isDoc ? '' : artifact.format === 'dataset' ? JSON.stringify(await loadDatasetRows(artifact)) : artifact.content,
      columns: meta.columns ?? [],
      ...(artifact.format==='dataset' && (artifact.meta as Record<string,unknown>).catalog ? {catalog:catalogOf(artifact)!}:{}),
      // A stored FILE is not a document the app can render, so its view is the
      // two facts a person picks a file by plus the link that opens it.
      ...(artifact.format === 'pdf' ? { bytes: (meta as { bytes?: number }).bytes ?? 0, pages: (meta as { pages?: number }).pages ?? null } : {}),
      compiledCss: isDoc ? await currentStoryCss(meta, artifact.source) : meta.compiledCss ?? null,
      theme: design.theme,
      colorMode: design.colorMode,
      template: meta.template ?? null,
      refs: meta.refs ?? [],
      // Paint first: the DECLARATIONS, not the rows. The page's copy exists to
      // seed the editor, and the editor runs a draft's queries itself — so
      // running them here only held the owner's own page behind the SQL, with
      // the results inlined into its HTML (withBootstrap).
      dataflow: isDoc && artifact.source ? declarationsForRow(artifact) : null,
      accountSession: kind === 'account',
      anonSession: kind === 'anon',
      version: artifact.version,
      // Anyone who may COMMENT has a comment badge to fill: computing this
      // for the owner alone left an editor's and a commenter's count at 0
      // forever, on a control they were being shown.
      openAnnotations: canAnnotate(role) && isDoc ? await countOpenAnnotations(artifact.id) : 0,
    },
  }, 200, { 'Cache-Control': 'no-store' });
}
