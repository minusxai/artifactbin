/**
 * The owner/editor SHELL's props for one document — everything ArtifactDocument
 * used to compute on the server: the ACL (uniform 404), the exporter's signed
 * key, the canonical address (the client heals to it), the viewer's role and
 * session kind, and ArtifactSurface's props (compiled CSS, design, the
 * server-run dataflow, the open-annotation count).
 */
import { countOpenAnnotations } from '@/lib/annotations';
import { canReadArtifact, declarationsForRow, getArtifactById } from '@/lib/artifacts';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { verifyExportKey } from '@/lib/export-key';
import { previewFrom } from '@/lib/features';
import { json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { ARTIFACT_FORMATS, type ArtifactFormat } from '@/lib/story/input';
import { canonicalArtifactPath } from '@/lib/urls';
import { ownerUsername } from '@/lib/users';
import { browserSessionKind, roleFor, sessionActor } from '@/lib/viewer';
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

  const meta = (artifact.meta ?? {}) as {
    theme?: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null;
    columns?: Array<{ name: string; type?: string }>; template?: string | null; refs?: Array<{ id: string; kind: string }>;
    cssCompileVersion?: string | null;
  };
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
  const role = await roleFor(artifact, actor);
  const kind = await browserSessionKind(request);
  return json({
    canonical: canonicalArtifactPath(artifact, await ownerUsername(artifact.user_id)),
    role,
    kind,
    surface: {
      captureKey: exporting ? key : null,
      id: artifact.id,
      editId: artifact.edit_id,
      format: artifact.format,
      title: artifact.title,
      source: artifact.source,
      content: artifact.format === 'markup' ? '' : artifact.format === 'dataset' ? JSON.stringify(await loadDatasetRows(artifact)) : artifact.content,
      columns: meta.columns ?? [],
      compiledCss: artifact.format === 'markup' ? await currentStoryCss(meta, artifact.source) : meta.compiledCss ?? null,
      theme: design.theme,
      colorMode: design.colorMode,
      template: meta.template ?? null,
      refs: meta.refs ?? [],
      // Paint first: the DECLARATIONS, not the rows. The page's copy exists to
      // seed the editor, and the editor runs a draft's queries itself — so
      // running them here only held the owner's own page behind the SQL, with
      // the results inlined into its HTML (withBootstrap).
      dataflow: artifact.format === 'markup' && artifact.source ? declarationsForRow(artifact) : null,
      accountSession: kind === 'account',
      anonSession: kind === 'anon',
      preview: previewFrom(search),
      version: artifact.version,
      // Anyone who may COMMENT has a comment badge to fill: computing this
      // for the owner alone left an editor's and a commenter's count at 0
      // forever, on a control they were being shown.
      openAnnotations: canAnnotate(role) && artifact.format === 'markup' ? await countOpenAnnotations(artifact.id) : 0,
    },
  }, 200, { 'Cache-Control': 'no-store' });
}
