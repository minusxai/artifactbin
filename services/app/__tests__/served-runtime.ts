/**
 * The reader's FULL served runtime for a document, as lib/publish/prepared/prepared-page.server `servedPage` builds it
 * for a request: sheet, system sheet, overrides, author script, reader data, stored drawings, and (when asked) this
 * reader's first results, admitted as the query door admits them.
 *
 * The app's own doors (the JSON door and the HTML door, lib/serving/artifact-page) no longer carry it for a framed
 * document — they answer its title and declared dataflow (`FramedRuntime`); the sheet and script run in the frame, on the
 * document's own origin. Tests that guard what the runtime holds ask for it here, not through a door that trims it.
 * The reader is the harness session (`setSession`), as the door's was; access is the caller's to have checked.
 */
import { request as harnessRequest } from './harness';
import { archivedVersionFor, getArtifactById } from '@/lib/artifacts';
import { sessionActor } from '@/lib/accounts';
import { preparedPageFor, servedPage } from '@/lib/publish/prepared/prepared-page.server';

export interface ServedRuntimeOptions {
  /** The page's query string: the reader's `$` values, `?version=N`, `?mermaid=engine`. */
  search?: string;
  /** Serve this reader's first results. */
  results?: boolean;
}

export async function servedRuntimeOf(id: string, options: ServedRuntimeOptions = {}) {
  const search = options.search ?? '';
  const req = harnessRequest(`/api/page/artifact/${id}${search}`);
  const row = (await getArtifactById(id))!;
  const at = await archivedVersionFor(req, row, {});
  if (at === 'not_found') throw new Error('no such version');
  const actor = await sessionActor(req);
  const prepared = await preparedPageFor(row, at, {});
  const { runtime } = await servedPage(prepared.row, prepared.page, {
    at, search,
    drawings: /[?&]mermaid=engine\b/.test(search) ? 'engine' : 'stored',
    viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null },
    ...(options.results ? { results: { admit: actor.viewer } } : {}),
  });
  return runtime;
}
