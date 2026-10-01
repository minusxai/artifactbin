import { type ArtifactRow, type TokenActor, type Visibility } from './access';
import { afterCreated, artifactQuotaExceeded, assetImporterFor, byteQuotaFor, createArtifact, fontResolver, getArtifact, getArtifactById, getArtifactFor, getLinkReadableArtifact, type ArtifactInput } from './store';
import { compiledForRow, refLoaderForActor, rowToResolvedRef } from './dataflow';
import { artifactQuery } from './document';
import { grantsOf, grantsPermitRead } from '../datasets/policy/grants';
import { reserveArtifactIds } from './identities';
import { collectRefUses } from '@/lib/story/data/refs';
import { catalogOf } from '@/lib/datasets/catalog';
import { DatasetError } from '@/lib/datasets/errors';
import { trackEvent } from '../platform/analytics';
import { sourceWithoutAnchors } from '../annotations/anchors';
import { getDb } from '../platform/db';
import { remapDatasetGrants } from '@artifactbin/utils';
import { parseContentInput } from '../story/document/input';
import { json } from '../http/http';
import { mutationTargetRef } from '@/lib/story/data/compiled-flow';
import type { RefLoader } from '@/lib/story/data';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';

/**
 * What a forker may change about the copy AS IT IS MADE — the three fields an
 * owner reaches for first. Every value here is already validated by the
 * caller through the shared parsers (lib/artifact-wire
 * `parseVisibilityValue`/`parseFolderField`), so this door does not
 * re-decide, for instance, whether an anonymous token may go private.
 */
export interface ForkOverrides {
  title?: string;
  visibility?: Visibility;
  /** Where the COPY lands, already resolved (lib/folders resolveParent). Absent = the forker's root. */
  ancestor_ids?: string[];
}

/**
 * FORK — the same artifact under a NEW OWNER and a new id, and nothing else.
 *
 * Which parts of a document travel and which belong to the original's life is stated once, in
 * [serving and security](../../../docs/serving-and-security.md). Two things the doc cannot say:
 * object-store bytes are REFERENCED rather than re-uploaded (every key is content-addressed, so a
 * fork of a 27 MB sheet costs no bytes), and a Postgres catalog copies only when the forker owns
 * its live connection.
 *
 * A markup document is RE-PUBLISHED as the forker rather than row-copied, and that is the whole
 * point of the function: refs resolve through `refLoaderForActor(actor)`, so a document whose
 * <Mutation> writes the original owner's dataset, or which reads their private image, is refused
 * BY NAME at this door instead of publishing and failing every write at run time. The refusal
 * Response passes through verbatim.
 *
 * `overrides` are applied to the copy's stored state rather than written afterwards: a post-hoc
 * title would be a second write, rotating the `edit_id` the create reply just handed back.
 *
 * FORKING AN APP. A page that WRITES a dataset may only be published by someone who owns that
 * dataset (lib/story/data/refs `validateRefs`), so a fork that kept the original's `ref:` was refused
 * for everyone but its owner — an app could not be forked at all. So the fork COPIES each dataset
 * the page writes and cannot write as the forker, under the forker's account, and repoints every
 * `ref:` to the copy (`writtenDatasetForkPlan`). Datasets the page only READS keep their id: a read
 * is already permitted, and copying a live source would freeze it at the moment of the fork.
 */
export async function forkArtifact(
  actor: TokenActor,
  source: ArtifactRow,
  overrides: ForkOverrides = {},
  /**
   * WHO THE COPY BELONGS TO, when that is not the forker: an account forking
   * one of its readable artifacts `as` one of its TEST USERS (lib/testusers).
   *
   * Only ownership moves. The source is still read, the refs are still
   * re-validated and the artifact COUNT quota is still charged AS THE ACCOUNT
   * — a test user has no reach of its own to fork through and no quota of its
   * own to spend, and this door is the single way anything real gets into its
   * sandbox.
   */
  owner: TokenActor = actor,
): Promise<ForkResult | Response> {
  /*
   * WHO CREATES vs WHO OWNS. The copy is created BY the forker's token and FOR
   * the owner's account, which is how the artifact COUNT quota lands on the
   * parent: the cap is per TOKEN, a test user has no quota of its own, and rows
   * carrying the test user's token would have been free. Ownership is `user_id`
   * (ownsArtifact reads it first), so the test user owns the copy outright —
   * and erasing it takes the rows, and the parent's count, away again.
   */
  const creator: TokenActor = { tokenId: actor.tokenId, userId: owner.userId };
  /*
   * A FOLDER IS NOT FORKABLE, and the refusal lives HERE so both doors — the
   * one a person clicks and the `fork_artifact` operation — inherit it from the
   * same place. A folder's source names its OWN children table by id, so a copy
   * would faithfully list the original's children; and re-pointing it at the
   * copy would silently rewrite a document the forker never wrote.
   */
  const unforkable = forkRefusal(source);
  if (unforkable) return unforkable;
  const copying = await writtenDatasetForkPlan(actor, source, owner);
  // The page PLUS its dataset copies: one cap, counted against what this call
  // will really create rather than against the page alone.
  if (await artifactQuotaExceeded(actor.tokenId, copying.length + 1)) return json({ error: 'quota_exceeded', details: ['this token has hit its artifact COUNT quota — deleting does not free it (nothing is erased), so ask your user for another token'] }, 403);
  if (copying.length) return deepFork(actor, source, overrides, copying, creator);
  const input = await forkInput(actor, source, overrides);
  if (input instanceof Response) return input;
  const row = await createArtifact(creator.tokenId, creator.userId, input, { forkedFrom: source.id, linkRole: source.link_role, ...(source.format==='dataset'?{datasetPolicy:{policy:source.dataset_policy??null,revision:source.policy_revision??0}}:{}) });
  // Against the SOURCE: "this was forked" is a fact about the original, and the
  // forker is who did it. Never inside a transaction (PGLite deadlock).
  void trackEvent('fork', source.id, { userId: actor.userId, forkId: row.id });
  return { artifact: row, datasets: [] };
}

/**
 * WHAT CANNOT BE FORKED AT ALL, decided before anything is copied — and before
 * a DRY RUN answers, so "what would this copy?" and "copy it" refuse the same
 * things in the same words.
 *
 * A FOLDER's source names its OWN children table by id, so a copy would
 * faithfully list the original's children and re-pointing it would silently
 * rewrite a document the forker never wrote. A live POSTGRES catalog keeps its
 * credentials bound to the original, so the copy could not answer one query.
 */
export function forkRefusal(source: ArtifactRow): Response | null {
  if (source.format === 'folder') {
    return json({ error: 'not_forkable', hint: "a folder cannot be forked — create one with format: 'folder' and file documents under it with parent_id" }, 400);
  }
  return source.format === 'markup' ? null : postgresForkRefusal(source);
}

/** What one fork made: the copy, and a copied dataset per `ref:` it had to repoint. */
export interface ForkResult {
  artifact: ArtifactRow;
  /** Empty for everything but an app — `forked_from` is the ORIGINAL dataset this copy was taken from. */
  datasets: Array<{ id: string; forked_from: string }>;
}

/**
 * The datasets a fork by `actor` would COPY: every distinct dataset this page
 * declares a `<Mutation>` over that the forker could not write as it stands.
 *
 * In source order, which is the order the dry run reports and the order the
 * copies are created in. Four things are deliberately NOT planned, because each
 * one is an existing refusal that must keep its own words rather than become a
 * silent copy:
 *   - a dataset the forker already reaches through their own scope — the write
 *     is admitted exactly as it is, and re-copying it would fork their own data;
 *   - a `ref:` that does not resolve for them, or is not a dataset at all (a
 *     FOLDER's children are computed; there is nothing to copy);
 *   - a POSTGRES-backed dataset, whose credentials stay bound to the original
 *     (`postgresForkRefusal`), so the copy could not answer a single query.
 * Each falls through to `validateRefs`, which names it at the publish door.
 */
async function writtenDatasetForkPlan(actor: TokenActor, source: ArtifactRow, owner: TokenActor = actor): Promise<ArtifactRow[]> {
  if (source.format !== 'markup' || !source.source) return [];
  const uses = collectRefUses(sourceWithoutAnchors(source.source));
  if (!uses) return [];
  const plan: ArtifactRow[] = [];
  const seen = new Set<string>();
  const compiled = await compiledForRow(source);
  const written = new Set((compiled?.mutations ?? []).flatMap((m) => mutationTargetRef(compiled!, m) ?? []));
  for (const use of [...uses.filter(u=>written.has(u.id)),...uses.filter(u=>!written.has(u.id))]) {
    if(seen.has(use.id))continue;
    seen.add(use.id);
    const candidate=await getArtifactById(use.id);
    if(!candidate||candidate.format!=='dataset'||catalogOf(candidate)?.kind==='postgres')continue;
    const policy=grantsOf(candidate);
    if(policy){
      if(!written.has(use.id)&&await grantsPermitRead(candidate,{userId:null,tokenId:null}))continue;
      if(!(await grantsPermitRead(candidate,actor,source)))continue;
      plan.push(candidate);continue;
    }
    if(!written.has(use.id))continue;
    const own = owner.userId ? await getArtifactFor({ userId: owner.userId, tokenId: '' }, use.id) : await getArtifact(owner.tokenId, use.id);
    if (own) continue;
    const row = (owner.userId !== actor.userId ? await getArtifactFor(actor, use.id) : null) ?? await getLinkReadableArtifact(use.id);
    if (!row || row.format !== 'dataset' || catalogOf(row)?.kind === 'postgres') continue;
    plan.push(row);
  }
  return plan;
}

/** What a fork of this page would copy, for the DRY RUN — the plan, as titles. */
export async function forkDatasetPreview(actor: TokenActor, source: ArtifactRow, owner: TokenActor = actor): Promise<Array<{ id: string; title: string | null }>> {
  if (source.format === 'folder') return [];
  return (await writtenDatasetForkPlan(actor, source, owner)).map((row) => ({ id: row.id, title: row.title }));
}

/**
 * The app fork: the dataset copies and the page, in ONE transaction.
 *
 * Everything that can REFUSE happens before it opens — the ids are reserved,
 * the source is repointed and the whole document is re-validated against a
 * loader that answers for the copies as though they already existed. So the
 * transaction is inserts only, and a failure halfway leaves no orphan dataset
 * sitting in the forker's account under a page that was never created.
 */
async function deepFork(actor: TokenActor, source: ArtifactRow, overrides: ForkOverrides, copying: ArtifactRow[], owner: TokenActor = actor): Promise<ForkResult | Response> {
  // Reserved for whoever will OWN the copies: `claimArtifactId` consumes a
  // reservation only for the actor creating the row, so reserving as the forker
  // and inserting as its test user would refuse its own fork.
  const ids = await reserveArtifactIds(owner, copying.length+1);
  const documentId=ids[copying.length]!;
  const policyRewrite={[source.id]:documentId};
  const copies = copying.map((row, index) => ({ row, id: ids[index]! }));
  const rewrite = new Map(copies.map((copy) => [copy.row.id, copy.id]));
  const planned = new Map(copies.map((copy) => [copy.id, copy.row]));
  const loader = refLoaderForActor(actor);
  const input = await forkInput(actor, source, overrides, {
    source: repointRefs(sourceWithoutAnchors(source.source ?? ''), rewrite),
    // A planned copy resolves as the forker's OWN dataset, with the original's
    // columns, access and policy — which is what it will be a moment from now.
    loadRef: async (id) => {
      const original = planned.get(id);
      return original ? { ...rowToResolvedRef(original, true), id } : loader(id);
    },
  });
  if (input instanceof Response) return input;
  const visibility = input.visibility ?? source.visibility;
  let created: { artifact: ArtifactRow; datasets: ArtifactRow[] };
  try {
    created = await (await getDb()).transaction(async (tx) => {
    await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[source.id,...copies.map(c=>c.row.id)]]);
    const currentSource=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[source.id])).rows[0];
    if(!currentSource||currentSource.edit_id!==source.edit_id)throw new DatasetError('The source changed; retry the fork',409);
    for(const copy of copies){
      if(!grantsOf(copy.row))continue;
      const current=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[copy.row.id])).rows[0];
      if(!current||current.edit_id!==copy.row.edit_id||current.policy_revision!==copy.row.policy_revision||!await grantsPermitRead(current,actor,currentSource,tx))throw new DatasetError('A dataset changed or is no longer readable; retry the fork',409);
    }
    const datasets: ArtifactRow[] = [];
    for (const copy of copies) {
      datasets.push(await createArtifact(owner.tokenId, owner.userId, {
        title: copy.row.title,
        description: copy.row.description,
        format: 'dataset',
        // The same content and the same object key: dataset bytes are
        // content-addressed, so a copy of a million rows re-uploads nothing.
        source: copy.row.source,
        meta: copy.row.meta,
        // The copy is as reachable as the page that writes it — no more.
        visibility: copy.row.visibility==='private'?'private':visibility,
        access: copy.row.access,
      }, {
        tx,
        reservedId: copy.id,
        forkedFrom: copy.row.id,
        linkRole: copy.row.link_role,
        // The write policy travels WITH the dataset: a copy whose policy had to
        // be set afterwards would be, for that moment, a writable dataset with
        // no rules, and the fork would need a second call to be usable at all.
        ...(copy.row.dataset_policy ? { datasetPolicy: { policy: grantsOf(copy.row)?remapDatasetGrants(grantsOf(copy.row)!,policyRewrite):copy.row.dataset_policy, revision: copy.row.policy_revision ?? 0 } } : {}),
      }));
    }
    return { artifact: await createArtifact(owner.tokenId, owner.userId, input, { tx, reservedId:documentId, forkedFrom: source.id, linkRole: source.link_role }), datasets };
    });
  } catch (error) {
    // A dataset rule refusing a copy is the forker's answer, never a 500.
    if (error instanceof DatasetError) return json({ error: 'dataset_error', details: [error.message] }, error.status);
    throw error;
  }
  // After the commit, never inside it (PGLite deadlock).
  for (const row of [...created.datasets, created.artifact]) await afterCreated(row, owner.userId);
  void trackEvent('fork', source.id, { userId: actor.userId, forkId: created.artifact.id });
  return { artifact: created.artifact, datasets: created.datasets.map((row) => ({ id: row.id, forked_from: row.forked_from! })) };
}

/**
 * EVERY `ref:<id>` occurrence of a copied dataset, repointed at its copy — one
 * pass, so a `<Query>` reading the same dataset the `<Mutation>` writes, a
 * `<Value source>` and any position added later all move together. A page that
 * kept one old id would read the original's rows and write its own copy.
 */
function repointRefs(source: string, rewrite: Map<string, string>): string {
  return source.replace(/ref:([A-Za-z0-9]{6,12})/g, (whole, id: string) => (rewrite.has(id) ? `ref:${rewrite.get(id)}` : whole));
}

/** The copy's stored state, as the forker would have published it. */
async function forkInput(
  actor: TokenActor,
  source: ArtifactRow,
  overrides: ForkOverrides,
  /** An APP fork: the repointed source and the loader that answers for its planned dataset copies. */
  deep?: { source: string; loadRef: RefLoader },
): Promise<ArtifactInput | Response> {
  // Everything the copy keeps that is not the content itself, with the
  // forker's overrides winning. `link_role` is carried too, but through
  // createArtifact's creation-only argument rather than here: it is not part
  // of ArtifactInput, which the replace path shares. With no placement
  // override, the copy lands at the forker's ROOT — the only place they could
  // have filed it without naming a folder of their own.
  const carried = {
    title: overrides.title ?? source.title,
    description: source.description,
    visibility: overrides.visibility ?? source.visibility,
    access: source.access,
    ...(overrides.ancestor_ids !== undefined ? { ancestor_ids: overrides.ancestor_ids } : {}),
  };
  if (source.format !== 'markup') {
    const refusal=postgresForkRefusal(source);
    if(refusal)return refusal;
    return { ...carried, format: source.format, source: source.source, meta: source.meta };
  }
  const meta = source.meta as { theme?: string; template?: string; colorMode?: 'light' | 'dark' | null };
  // Publish the LIVE vocabulary, exactly as the wire echo does: a stored
  // retired theme would otherwise make an old document unforkable for a reason
  // nobody could act on.
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode ?? null);
  const parsed = await parseContentInput({
    markup: deep?.source ?? sourceWithoutAnchors(source.source ?? ''),
    theme: design.theme,
    template: meta.template ?? null,
    colorMode: design.colorMode,
  }, {
    loadRef: deep?.loadRef ?? refLoaderForActor(actor),
    importAsset: assetImporterFor(actor.tokenId, actor.userId),
    resolveFont: fontResolver(),
    overByteQuota: byteQuotaFor(actor.tokenId),
  });
  if (parsed instanceof Response) return parsed;
  const { derivedTitle: _derived, ...stored } = parsed;
  return { ...carried, ...stored };
}

/** A live remote catalog cannot copy its dataset-bound secret to a new id. */
function postgresForkRefusal(source:ArtifactRow):Response|null {
  if(source.format!=='dataset')return null;
  const catalog=catalogOf(source);
  if(catalog?.kind!=='postgres')return null;
  return json({error:'not_forkable',hint:'Postgres credentials remain bound to the original dataset'},403);
}
