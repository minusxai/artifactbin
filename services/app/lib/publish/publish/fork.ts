import {planHtmlClone} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {authorizeDatasetBinding,DatasetBindingUnsupportedError} from '@/lib/dataset-graphql';
import { newArtifactDestination, type ArtifactInput, artifactQuotaExceeded, type ArtifactRow, createArtifact, unservable } from '@/lib/artifacts';
import type {ArtifactDestination, Visibility} from '@artifactbin/contracts';
import { identityForUser, type TokenHoldingActor } from '@/lib/accounts';
import { catalogOf, DatasetError } from '@/lib/datasets';
import { trackEvent } from '@/lib/analytics';
import { json } from '@/lib/http';

/**
 * What a forker may change about the copy AS IT IS MADE — the three fields an
 * owner reaches for first. Every value here is already validated by the
 * caller through the shared parsers (lib/artifact-wire
 * `parseVisibilityValue`/`parseFolderField`), so this door does not
 * re-decide, for instance, whether an anonymous token may go private.
 */
export interface ForkOverrides {
  destination?:ArtifactDestination;
  title?: string;
  visibility?: Visibility;
  /** Where the COPY lands, already resolved (lib/folders resolveParent). Absent = the forker's root. */
  ancestor_ids?: string[];
}

/**
 * FORK — the same artifact under a NEW OWNER and a new id, and nothing else.
 *
 * Which parts of a document travel and which belong to the original's life is stated once, in
 * [serving and security](../../../../docs/serving-and-security.md). Two things the doc cannot say:
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
 * dataset (lib/dataflow/refs `validateRefs`), so a fork that kept the original's `ref:` was refused
 * for everyone but its owner — an app could not be forked at all. So the fork COPIES each dataset
 * the page writes and cannot write as the forker, under the forker's account, and repoints every
 * `ref:` to the copy (`writtenDatasetForkPlan`). Datasets the page only READS keep their id: a read
 * is already permitted, and copying a live source would freeze it at the moment of the fork.
 */
export async function forkArtifact(
  actor: TokenHoldingActor,
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
  owner: TokenHoldingActor = actor,
): Promise<ForkResult | Response> {
  /*
   * WHO CREATES vs WHO OWNS. The copy is created BY the forker's token and FOR
   * the owner's account, which is how the artifact COUNT quota lands on the
   * parent: the cap is per TOKEN, a test user has no quota of its own, and rows
   * carrying the test user's token would have been free. Ownership is `user_id`
   * (ownsArtifact reads it first), so the test user owns the copy outright —
   * and erasing it takes the rows, and the parent's count, away again.
   */
  let destination:ArtifactDestination;
  try{destination=await newArtifactDestination(owner,overrides.destination,overrides.ancestor_ids?.at(-1));}
  catch(error){if(error instanceof DatasetError)return json({error:'invalid_destination',details:[error.message]},error.status);throw error;}
  overrides={...overrides,destination};
  // Created BY the forker's token, owned BY the owner's account: a row principal, never a request's grant.
  const creator = identityForUser(owner.userId, actor.tokenId);
  /*
   * A FOLDER IS NOT FORKABLE, and the refusal lives HERE so both doors — the
   * one a person clicks and the `fork_artifact` operation — inherit it from the
   * same place. A folder's source names its OWN children table by id, so a copy
   * would faithfully list the original's children; and re-pointing it at the
   * copy would silently rewrite a document the forker never wrote.
   */
  const unforkable = forkRefusal(source);
  if (unforkable) return unforkable;
  // A copy is born marked current (lib/dataflow/data-syntax): a retired stored shape is never copied into one.
  const retired = unservable(source);
  if (retired) return retired.response();
  const publicationOwner:TokenHoldingActor=destination.type==='group'?{...identityForUser(null,creator.tokenId),groupId:destination.id}:creator;
  if(await artifactQuotaExceeded(actor.tokenId,1))return json({error:'quota_exceeded'},403);
  const input = await forkInput(publicationOwner, source, overrides);
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
  return postgresForkRefusal(source);
}

/** What one fork made: the copy, and a copied dataset per `ref:` it had to repoint. */
interface ForkResult {
  artifact: ArtifactRow;
  /** Empty for everything but an app — `forked_from` is the ORIGINAL dataset this copy was taken from. */
  datasets: Array<{ id: string; forked_from: string }>;
}

/** The copy's stored state, as the forker would have published it. */
async function forkInput(
  actor: TokenHoldingActor,
  source: ArtifactRow,
  overrides: ForkOverrides,
): Promise<ArtifactInput | Response> {
  // Everything the copy keeps that is not the content itself, with the
  // forker's overrides winning. `link_role` is carried too, but through
  // createArtifact's creation-only argument rather than here: it is not part
  // of ArtifactInput, which the replace path shares. With no placement
  // override, the copy lands at the forker's ROOT — the only place they could
  // have filed it without naming a folder of their own.
  const carried = {
    destination:overrides.destination,
    title: overrides.title ?? source.title,
    description: source.description,
    visibility: overrides.visibility ?? source.visibility,
    access: source.access,
    ...(overrides.ancestor_ids !== undefined ? { ancestor_ids: overrides.ancestor_ids } : {}),
  };
  if(source.format==='html'){
    const {htmlLinks,htmlIdentity,htmlLibraries,...meta}=source.meta;
    try{
      const plan=await planHtmlClone(actor,source.id,(htmlLinks??[]) as import('@artifactbin/contracts').HtmlPageLink[],{backend:getHtmlBackendVersion,authorizeDataset:authorizeDatasetBinding});
      return {...carried,format:'html',source:source.source,meta,...plan};
    }catch(error){
      if(error instanceof DatasetBindingUnsupportedError)return json({error:error.code,hint:error.hint},400);
      if(error instanceof Error&&error.message==='dataset_not_found')return json({error:'dataset_not_found'},400);
      throw error;
    }
  }
  const refusal=postgresForkRefusal(source);
  if(refusal)return refusal;
  return {...carried,format:source.format,source:source.source,meta:source.meta};
}

/** A live remote catalog cannot copy its dataset-bound secret to a new id. */
function postgresForkRefusal(source:ArtifactRow):Response|null {
  if(source.format!=='dataset')return null;
  const catalog=catalogOf(source);
  if(catalog?.kind!=='postgres')return null;
  return json({error:'not_forkable',hint:'Postgres credentials remain bound to the original dataset'},403);
}
