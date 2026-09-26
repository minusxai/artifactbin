/**
 * AN OLDER VERSION, AT AN ADDRESS — `?version=N` on the document itself.
 *
 * History was API-only: `GET /api/artifacts/:id/versions/:version` hands back
 * bytes, and the only in-BROWSER view of an old version was the owner's
 * edit-mode panel, which has no shareable address. So an agent checking what a
 * page looked like before its change could neither photograph it
 * (`afbin export <id>@N --format png` refused) nor drive it in a live session
 * (`page.goto` can only reach the head).
 *
 * This module is the ONE decision behind all three doors — the served document
 * (app/a/[id]/raw), the page data (app/api/page/artifact/[id]) and the export
 * (lib/export) — so they cannot disagree about who may see an old version or
 * about what "version 3" resolves to.
 *
 * THE ACL IS `getVersionFor`'s, deliberately reused rather than restated: its
 * editor scope is what already decides who may read version history at all
 * (the owner and named editors), so a viewer-role share — someone who may read
 * the document — learns nothing here, not even that the parameter exists. Every
 * refusal is the caller's own uniform 404: an invalid number, a version that
 * was never archived, a reader without history access and a format that has no
 * document all answer the same way.
 *
 * The answer is a TRI-STATE on purpose. `null` is "this request asked for no
 * version" (the head, unchanged); `'not_found'` is "it asked and the answer is
 * the uniform 404"; anything else is the version to render. Collapsing the
 * first two would make a missing parameter indistinguishable from a refused
 * one at every call site.
 */
import { getVersionFor, listVersionsFor, versionForCapture, type ArtifactRow, type TokenActor } from '@/lib/artifacts';
import { inCurrentSyntax } from '@/lib/migrate/sqlite/stored';
import { actorForArtifacts, requestOrSessionActor } from '@/lib/viewer';

/** The parameter's name, in one place: the three doors and the export URL. */
export const VERSION_PARAM = 'version';

/**
 * The reason a `<Mutation>` is unavailable on an archived render — a CODE
 * rather than prose for the same reason `sign_in_required` is one: a script
 * reading `mx.describe()` wants a name, not a sentence. The sentence a person
 * reads is {@link archivedReadOnly}.
 */
export const ARCHIVED_VERSION = 'archived_version';

/**
 * What a refused write says to the person who pressed it. The chrome line that
 * says WHICH version this is lives with the chrome that draws it
 * (lib/story/reader-chrome archivedBanner) — this module stays off the reader's
 * bundle, and that one is already on it.
 */
export const archivedReadOnly = (version: number): string => `Version ${version} is read-only`;

/** One archived version, resolved: its stored bytes and the metadata it was saved with. */
export interface ArchivedRender {
  /** The version being shown. */
  version: number;
  /** The head version at this moment — the `M` in "version N of M". */
  head: number;
  source: string;
  meta: Record<string, unknown>;
  title: string | null;
  description: string | null;
  /**
   * Written for the previous query engine, in a way the migration's converter
   * cannot carry over without a person: its queries answer PREVIOUS_ENGINE
   * (lib/story/data-syntax) rather than failing on syntax this engine refuses.
   */
  previousEngine?: true;
}

/**
 * What this address asks for: a version number, `'none'` (no `version` key at
 * all) or `'invalid'`.
 *
 * Judged strictly — a positive decimal integer and nothing else — because the
 * refusal for a malformed number and the refusal for a version nobody may read
 * must be the SAME 404. A lenient `Number()` would answer `?version=1e3` and
 * `?version=+1` differently from the archive's own numbering.
 */
export function versionAsked(url: string): number | 'none' | 'invalid' {
  const raw = new URL(url).searchParams.get(VERSION_PARAM);
  if (raw === null) return 'none';
  return /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : 'invalid';
}

/** The head as an {@link ArchivedRender} — `?version=<head>` renders it with the same banner. */
const headRender = (row: ArtifactRow): Omit<ArchivedRender, 'version' | 'head'> => ({
  source: row.source ?? '',
  meta: (row.meta ?? {}) as Record<string, unknown>,
  title: row.title,
  description: row.description,
});

type RenderBody = Omit<ArchivedRender, 'version' | 'head'>;

/**
 * HISTORY STAYS AS STORED; its render speaks the current syntax: a version
 * without the data-syntax marker is served converted (lib/migrate/sqlite/stored).
 */
async function archived(row: ArtifactRow, version: number, head: number, body: RenderBody): Promise<ArchivedRender> {
  const { source, meta, previousEngine } = await inCurrentSyntax({ id: row.id, version, user_id: row.user_id, token_id: row.token_id, ...body });
  return { version, head, ...body, source: source ?? '', meta, ...(previousEngine ? { previousEngine } : {}) };
}

/**
 * THE DECISION. `null` = no version asked; `'not_found'` = the uniform 404;
 * otherwise the version to render.
 *
 * `capture` is the served document's export render: it arrives with a VERIFIED
 * export key and no session (lib/export photographs `raw?chrome=0&version=N`),
 * and the version ACL for it ran at the export door before that key existed.
 * Only a caller that has verified the key for this row may pass it.
 */
export async function archivedVersionFor(
  request: Request,
  row: ArtifactRow,
  opts: { capture?: boolean } = {},
): Promise<ArchivedRender | 'not_found' | null> {
  const asked = versionAsked(request.url);
  if (asked === 'none') return null;
  // Only a DOCUMENT has a version to render. A dataset, an image or a PDF at
  // `?version=` is the uniform 404 — not a second, half-built history view.
  if (asked === 'invalid' || row.format !== 'markup') return 'not_found';
  const head = row.version;
  if (opts.capture) {
    if (asked === head) return archived(row, asked, head, headRender(row));
    const shot = await versionForCapture(row, asked);
    return shot ? archived(row, asked, head, { source: shot.source ?? '', meta: shot.meta, title: shot.title, description: shot.description }) : 'not_found';
  }
  return archivedVersionForActor(actorForArtifacts(await requestOrSessionActor(request)), row, asked);
}

/**
 * The same decision for a caller that already holds the actor (the offline
 * download, lib/offline/assemble.server): version `asked` of a markup row, for
 * whoever may read its history, else `'not_found'`.
 */
export async function archivedVersionForActor(
  actor: TokenActor | null,
  row: ArtifactRow,
  asked: number,
): Promise<ArchivedRender | 'not_found'> {
  if (row.format !== 'markup' || !Number.isInteger(asked) || asked < 1) return 'not_found';
  const head = row.version;
  if (!actor) return 'not_found';
  /*
   * THE HEAD IS USUALLY NOT IN THE ARCHIVE. Save-less editing bumps `version`
   * on every accepted edit while snapshots coalesce, so the current version
   * commonly has no `artifact_versions` row at all — and `?version=<head>` must
   * still render, with the same banner. It is admitted through the SAME editor
   * scope, asked of the history listing rather than of a snapshot that may not
   * exist, so nothing about who may read history changes.
   */
  if (asked === head) return (await listVersionsFor(actor, row.id)) ? archived(row, asked, head, headRender(row)) : 'not_found';
  const found = await getVersionFor(actor, row.id, asked);
  return found ? archived(row, asked, head, { source: found.source ?? '', meta: found.meta, title: found.title, description: found.description }) : 'not_found';
}

/**
 * The row a render renders FROM: this artifact wearing that version's bytes
 * when one was asked for, the head otherwise — either one in the current data
 * syntax (lib/migrate/sqlite/stored inCurrentSyntax), so every door serves an
 * unmigrated document the same way.
 */
export async function servedRow(row: ArtifactRow, at: ArchivedRender | null): Promise<ArtifactRow> {
  if (!at) return row.format === 'markup' ? inCurrentSyntax(row) : row;
  return { ...row, source: at.source, meta: at.meta as ArtifactRow['meta'], title: at.title, description: at.description, ...(at.previousEngine ? { previousEngine: true as const } : {}) };
}
