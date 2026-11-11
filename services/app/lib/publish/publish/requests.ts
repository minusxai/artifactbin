import {LiveRegionRefusal} from '@/lib/live-regions';
import {documentOwner,type UserPagesOwner} from '@/lib/user-pages';
import {preparePublicationBundle} from './bundle';
import { getSharingFor, durableMutation, type MutationReceipt, type MutationReply, parseArtifactDestination, newArtifactDestination, type ArtifactInput, artifactQuotaExceeded, type ArtifactRow, byteQuotaFor, canReadArtifact, createArtifact, creationOperation, CreationReplay, findDependentsFor, getArtifactById, getArtifactFor, getOwnedArtifactFor, isVersionConflict, lookupCreation, observedChange, versionConflict, refLoaderForActor, replaceArtifactFor, ScheduleLimitError, setMetadataFor } from '@/lib/artifacts';
import { ownsArtifact, writerFor } from '@/lib/artifact-access';
import { committedOpenAnnotations, createdArtifactWire, parseAccessValue, parseExpectedVersion, parseLinkRoleValue, parseParentField, parseShareEntries, parseSharingRevision, parseVisibilityValue, placementFor, replacedArtifactWire } from '@/lib/artifact-wire';
import {htmlAssetLinks, htmlBackendNames, htmlGraphqlSources, htmlPageDeclarations} from '@/lib/html-page';
import { trackEvent } from '@/lib/analytics';
import {compilePageBackend,composePageSchema,pageDocumentProblems} from '@/lib/page-operations';
import {authorizeDatasetBinding,DatasetBindingUnsupportedError} from '@/lib/dataset-access';
import {pageDatasetCheckSources,pageDatasetRoots} from '@/lib/graphql-compat';
import type {HtmlDatasetLink,HtmlPageLink} from '@artifactbin/contracts';
import type {PreparedHtmlBackend} from '@/lib/html-backends';
/**
 * THE PUBLISH REQUESTS — create, replace and asset refresh, the use cases both
 * auth modes and the operations registry run over one pipeline. Story owns the
 * content pipeline they drive (prepareContentInput, the web-asset cache, the
 * data checks); lib/artifacts owns the storage, the access rules and the wire
 * shapes they answer with (artifacts/wire: the create and replace echoes, the
 * body parsers and the folder placement), so this module calls down into
 * artifacts and nothing in artifacts calls up into it.
 */
import { CONTENT_FIELDS, PAGE_SQL_ROOT, PAGE_SQL_TYPES, PAGE_VIEWER_ROOT, PAGE_VIEWER_TYPE, type DatasetAccess, type Visibility } from '@artifactbin/contracts';
import { identityForUser, shareTargetsRefusal, TEST_ACCOUNT_RESTRICTED, type AccessActor, type TokenHoldingActor } from '@/lib/accounts';
import { prepareCatalog, catalogOf, DatasetError, graphqlRootNameProblem } from '@/lib/datasets';
import { json, thrownMessage } from '@/lib/http';
import { ID_RE, getDb } from '@/lib/platform';
import { prepareContentInput, applyPreparedContent, type PreparedContent } from '../prepared/prepare-content';
import { lookupWebAssets, refreshWebAssets, type WebAssetImporter } from '../assets/web-assets';

async function updateBundleDependency(actor:TokenHoldingActor,base:string,id:string,body:Record<string,unknown>,key:string):Promise<Response>{
 // A changed bundle file needs edit access to its own artifact, never page ownership.
 if(!await getArtifactFor(actor,id))return json({error:'bundle_file_not_editable'},403);
 const saved=await durableMutation(actor,base,key,{id,body},async receipt=>{
  const response=await replaceArtifactWithBody(body,actor,id,base,{mutationReceipt:receipt});return {status:response.status,body:await response.json() as Record<string,unknown>};
 });return json(saved.body,saved.status);
}

async function prepareHtmlDatasets(body:Record<string,unknown>,actor:AccessActor):Promise<readonly HtmlDatasetLink[]|undefined|Response>{
 if(typeof body.html!=='string')return undefined;
 try{
  const {backends,datasets}=htmlPageDeclarations(body.html);
  await Promise.all(datasets.map(binding=>authorizeDatasetBinding(actor,binding)));
  const collision=await graphqlRootCollision(actor,backends,datasets);
  if(collision)return json({error:'graphql_root_collision',details:[collision]},400);
  return datasets;
 }catch(error){
  if(error instanceof DatasetBindingUnsupportedError)return json({error:error.code,hint:error.hint},400);
  return json({error:'invalid_dataset_binding'},400);
 }
}

/**
 * A dataset link mounts its roots flat at the top of the page schema: one equal to another link's name or to
 * another link's generated root or type refuses the page, naming both links; so does one meeting the built-in viewer
 * or `_sql`.
 */
async function graphqlRootCollision(actor:AccessActor,backends:readonly string[],datasets:readonly HtmlDatasetLink[]):Promise<string|null>{
 const reserved=(name:string)=>name===PAGE_VIEWER_ROOT||name===PAGE_VIEWER_TYPE?'the built-in viewer query':name===PAGE_SQL_ROOT||(PAGE_SQL_TYPES as readonly string[]).includes(name)?'the built-in read-only SQL query':null;
 const builtIn=(link:string,name:string)=>`link "${link}" ${link===name?'names':'generates'} ${name}, ${reserved(name)}; rename the link`;
 // Every page answers the built-in viewer and `_sql`: no link may be named, or generate, their roots or types.
 for(const name of backends)if(name===PAGE_VIEWER_ROOT||name===PAGE_SQL_ROOT)return builtIn(name,name);
 const owner=new Map<string,string>([...backends,...datasets.map(link=>link.name)].map(name=>[name,name]));
 for(const link of datasets){
  for(const name of await pageDatasetRoots(actor,link)){
   if(reserved(name))return builtIn(link.name,name);
   const other=owner.get(name);
   if(other!==undefined&&!(other===link.name&&name===link.name))return `link "${link.name}" generates ${name}, which link "${other}" also names; rename one link`;
   owner.set(name,link.name);
  }
 }
 return null;
}

async function prepareHtmlBackends(body:Record<string,unknown>,creating=false):Promise<PreparedHtmlBackend[]|undefined|Response>{
 // preparePublicationBundle adds the bundle's resolver files to resolverSources for every html save.
 if(body.resolverSources===undefined){
  if(creating&&typeof body.html==='string'&&htmlBackendNames(body.html).length)return json({error:'unresolved_backend_link'},400);
  return undefined;
 }
 if(typeof body.html!=='string'||!body.resolverSources||typeof body.resolverSources!=='object'||Array.isArray(body.resolverSources))return json({error:'invalid_backend_sources'},400);
 const entries=Object.entries(body.resolverSources as Record<string,unknown>);
 if(entries.length>20||entries.some(([name,source])=>!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name)||typeof source!=='string'||Buffer.byteLength(source)>4_000_000))return json({error:'invalid_backend_sources'},400);
 try{
  const names=htmlBackendNames(body.html);
  if(entries.some(([name])=>!names.includes(name))||creating&&names.some(name=>!entries.some(([key])=>key===name)))throw Error('Backend sources must match HTML links');
  const prepared=await Promise.all(entries.map(async([name,source])=>({name,source:source as string,...await compilePageBackend(source as string)})));
  if(prepared.length)composePageSchema(prepared.map(backend=>({name:backend.name,fileId:backend.name,version:'prepared',typeDefs:backend.typeDefs})));
  return prepared;
 }
 catch(error){return json({error:'invalid_backend',details:[thrownMessage(error,'Invalid backend')]},400);}
}

const PAGE_GRAPHQL_HINT='A resolver\'s caps.query and the page\'s own queries run on the page\'s GraphQL, where a linked dataset is named by its data-af-name, not by its own API name. Use the names given and publish again.';
/**
 * A save carrying resolver sources: the GraphQL documents its resolvers pass to caps.query, and the page's own static
 * gql documents, against the page's names (lib/page-operations `pageDocumentProblems`, over each linked dataset's
 * role-independent schema). A field the page lacks refuses the save before anything is written, naming the fix:
 * every such call would otherwise fail at run time with a detail only the owner sees. Nothing checkable is no refusal.
 */
async function pageGraphqlRefusal(actor:AccessActor,html:unknown,datasets:readonly HtmlDatasetLink[]|undefined,backends:readonly PreparedHtmlBackend[]|undefined):Promise<Response|null>{
 if(typeof html!=='string'||!backends?.length)return null;
 let schema:Awaited<ReturnType<typeof pageDatasetCheckSources>>;
 try{schema=await pageDatasetCheckSources(actor,datasets??[]);}catch{return null;}
 const {resolverFiles,scripts}=htmlGraphqlSources(html),prepared=new Set(backends.map(backend=>backend.name));
 const problems=await pageDocumentProblems({
  datasetSdl:schema?.sdl??null,datasets:schema?.sources??[],
  backends:backends.map(({name,typeDefs})=>({name,typeDefs})),unchecked:htmlBackendNames(html).filter(name=>!prepared.has(name)),
  resolvers:backends.map(backend=>({label:`resolver ${resolverFiles[backend.name]??backend.name+'.ts'}`,source:backend.source})),scripts,
 });
 return problems.length?json({error:'invalid_page_graphql',details:problems,hint:PAGE_GRAPHQL_HINT},400):null;
}

/**
 * `name` on create: the new dataset's GraphQL root (lib/datasets graphqlRootNameProblem), stored in its policy's
 * configuration and never changed. Only a new single-table stored dataset takes one, never a copy (forked_from).
 */
function parseGraphqlName(body:Record<string,unknown>,parsed:{format:string;meta:Record<string,unknown>},forkedFrom:string|null|undefined):string|undefined|Response{
 if(body.name===undefined)return undefined;
 const refuse=(detail:string)=>json({error:'invalid_graphql_name',details:[detail]},400);
 const problem=graphqlRootNameProblem(body.name);if(problem)return refuse(problem);
 const catalog=catalogOf(parsed);
 if(parsed.format!=='dataset')return refuse('name sets the GraphQL root of a new stored dataset (CSV or JSON rows)');
 if((catalog?.tables.length??1)>1)return refuse('a multi-table dataset\'s GraphQL roots are its table names');
 if(forkedFrom)return refuse('a copy takes its GraphQL root from its title: drop name or forked_from');
 return body.name as string;
}

function parseAccessField(body: Record<string, unknown>, format: string | undefined): DatasetAccess | undefined | Response {
  return parseAccessValue(body.access, format);
}

function parseVisibility(body: Record<string, unknown>, canPrivate: boolean): Visibility | undefined | Response {
  return parseVisibilityValue(body.visibility, canPrivate);
}

/**
 * What a page records of its publication (lib/html-publication-bundle PublicationRecord): its files' receipts, and the
 * entry's project path, against which a script's `fetch('./x')` names a file (publishedFileTable).
 */
const publicationRecord=(receipts:unknown[],entryPath:unknown)=>({htmlPublicationDependencies:receipts,...(typeof entryPath==='string'?{htmlPublicationEntryPath:entryPath}:{})});

/**
 * The full-replace pipeline both PUT routes run: read the body, validate the
 * content and the metadata fields, write inside one transaction, and answer.
 *
 * The actor decides scope AND whether `private` is even expressible — a token
 * claimed by an account stamps its artifacts with that account, so the actor's
 * userId IS the row's owner and no extra read is needed.
 */
/** The same pipeline with the body already in hand — what the operations registry calls. */
export async function replaceArtifactWithBody(
  body: Record<string, unknown> | null,
  actor: AccessActor,
  id: string,
  base: string,
  options: {dryRun?:boolean;mutationReceipt?:MutationReceipt;request?:Request} = {},
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  if(['markup','jsx','markdown','document_update'].some(key=>Object.hasOwn(body!,key)))return json({error:'native_html_required',hint:'Replace native pages with the complete html field and observed version and state.'},400);
  if(Object.hasOwn(body,'name'))return json({error:'graphql_name_immutable',details:['A dataset\'s GraphQL name is chosen once, when it is created, and never changes: drop name. Publish a new dataset with the name you want.']},400);
  // The row FIRST: refs and imports resolve as the DOCUMENT's owner, never as
  // the writer — an editor (artifact_shares.role) replacing a document that
  // carries its owner's <Mutation> or private image must not fail on assets
  // they could never own. Unreachable is the uniform 404, before any parse.
  const current = await getArtifactFor(actor, id);
  if (!current) return json({ error: 'not_found' }, 404);
  if(body.destination!==undefined)return json({error:'ownership_requires_transfer',hint:'Use the transfer endpoint to change owner.'},400);
  if(Object.hasOwn(body,'policy')||Object.hasOwn(body,'expectedPolicyRevision'))return json({error:'combined_policy_write',hint:'Publish content first, then change policy in the dataset YAML without replacing content.'},400);
  // Sharing settings use edit access; filing under an owner's folder still checks placement.
  const owned = body.parent_id !== undefined ? await getOwnedArtifactFor(actor, id) : null;
  const owner = writerFor(current);
  const sentMarkup = body.markup;
  if(body.annotation_ops!==undefined)return json({error:'invalid_annotation_operations'},400);
  const expected = parseExpectedVersion(body);
  if (expected instanceof Response) return expected;
  let bundleReceipts:unknown[]=[],bundleEntryPath:string|undefined;
  const bundleSupplied=body.publicationBundle!==undefined;
  // The caller's own fields: a bundle save injects the head's visibility and shares below, which are no change.
  const sent=body;
  if(typeof body.html==='string'){
    // A content write is fenced only on what it replaces (lib/artifacts state): a sharing or policy change since the read never refuses it.
    const changed=observedChange(current,expected);if(changed)return json(versionConflict(current,changed),409);
    if(body.publicationBundle!==undefined&&(expected.expectedVersion===undefined||expected.expectedState===undefined))return json({error:'bundle_requires_observed_state'},400);
    if(body.publicationBundle!==undefined&&(!actor.tokenId||options.dryRun))return json({error:'bundle_requires_authenticated_commit'},400);
    // Edit access to the page is enough to save a bundle; each file is then
    // authorized on its own (preparePublicationBundle). New files belong to the
    // page owner, so an editor's save never leaves the owner's page depending on
    // the editor's artifacts. The injected visibility/shares are the page's
    // current values, written under the same edit access a plain save has.
    let creator=actor as TokenHoldingActor,newFilesRefused=false;
    if(body.publicationBundle!==undefined){
      if(!await getOwnedArtifactFor(actor,id)){
        // A group page's files can be created as the group only by its editors, who own the page already.
        if(current.group_id)newFilesRefused=true;
        else creator={...writerFor(current),tokenId:current.token_id??creator.tokenId};
      }
      const sharing=await getSharingFor(actor,id);
      body={...body,visibility:body.visibility??current.visibility,shares:body.shares??sharing?.shares};
    }
    const bundled=await preparePublicationBundle(body,actor as TokenHoldingActor,base,options.request,(dependency,dependencyRequest)=>createArtifactFromBody(dependency,creator,base,dependencyRequest),(dependencyId,input,key)=>updateBundleDependency(actor as TokenHoldingActor,base,dependencyId,input,key),{id,resolvedBackendNames:((current.meta.htmlLinks??[]) as HtmlPageLink[]).filter(link=>link.kind==='backend').map(link=>link.name),dependencies:Array.isArray(current.meta.htmlPublicationDependencies)?current.meta.htmlPublicationDependencies:[],creator,newFilesRefused});
    if(bundled instanceof Response)return bundled;
    body=bundled.body;bundleReceipts=bundled.receipts;bundleEntryPath=bundled.entryPath;
  }
  /*
   * A FOLDER HAS NO CONTENT, AND THE REPLACE DOOR IS WHERE THAT IS ENFORCED.
   *
   * Measured on main before this: a plain `PUT {markup}` on a folder answered
   * 200 and rewrote `format` to `'markup'` — which orphaned every child (their
   * `ancestor_ids` still named a row that was no longer a folder), took the row
   * out of the shelf's `folders` partition, and made the id permanently
   * unusable as a `parent_id` (`resolveParent` refuses a non-folder). One
   * `update_artifact` destroyed the folder, irreversibly as far as any door
   * here is concerned.
   *
   * So the row's format is the truth and the body may not change it. Content
   * is refused BY NAME with the code the data tiers already answer — a folder
   * is a place, and `not_editable` is exactly what it means — and the METADATA
   * a folder does have (title, visibility, placement) still goes through, which
   * is how an agent renames one without a second door to learn.
   *
   * Above `parseContentInput` deliberately, for the reason the governance check
   * above gives: that parse FETCHES, and a refused write must not import the
   * caller's images on the way to being refused.
   */
  if (current.format === 'folder') {
    if (CONTENT_FIELDS.some((f) => body[f] !== undefined)) {
      return json({ error: 'not_editable', details: ['a folder has no content — its page is its listing. Only title, visibility and folder are editable, in the folder YAML you push'] }, 400);
    }
  }
  const prepared: PreparedContent | Response = current.format === 'folder'
    ? {content: { format: 'folder', source: '', meta: {}, derivedTitle: null }, objects: []}
    : await prepareContentInput({...(current.format==='dataset'?{columns:((current.meta.columns??[]) as import('@artifactbin/contracts').DatasetColumn[]).filter(c=>c.type==='user')}:{}),theme:current.meta.theme,template:current.meta.template,colorMode:current.meta.colorMode,...body}, {
      prepareDataset: (input,objects) => prepareCatalog(input,current,objects),
      loadRef: refLoaderForActor(owner),
      // Account-owned imports may have no historical creator credential.
      overByteQuota: byteQuotaFor(owner.tokenId, owner.userId),
    }, {allowRemoteInputs:!options.dryRun});
  if (prepared instanceof Response) return prepared;
  let parsed = prepared.content;

  const visibility = parseVisibility(body, !!actor.userId);
  if (visibility instanceof Response) return visibility;
  const parent = parseParentField(body);
  if (parent instanceof Response) return parent;
  const access = parseAccessField(body, parsed.format);
  if (access instanceof Response) return access;
  const shares=parseShareEntries(body.shares);if(shares instanceof Response)return shares;const boxed=await shareTargetsRefusal(actor,shares);if(boxed)return json({error:TEST_ACCOUNT_RESTRICTED,detail:boxed},403);
  if(body.visibility===null||body.linkRole===null)return json({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
  const link=parseLinkRoleValue(body.linkRole);if(link instanceof Response)return link;
  const expectedSharingRevision=parseSharingRevision(sent);
  if(expectedSharingRevision instanceof Response)return expectedSharingRevision;
  /*
   * PLACEMENT IS RESOLVED HERE, AFTER the scope answered `current` above — a
   * row this caller cannot reach is the uniform 404 whatever the body says,
   * and validating the parent first would answer 400 for an id that does not
   * exist for them, which is an existence oracle.
   *
   * …and it is the OWNER's verb, which this door alone has to say out loud:
   * the replace scope is `editorScope`, so a named editor reaches this line,
   * while every other way to move a row (the PATCH) is owner-scoped and
   * refuses them with the uniform 404 before a parent is ever looked at. An
   * editor may rewrite the document; filing it — into a folder of the owner's,
   * or out to the root — is not theirs to do (lib/artifacts ownerScope: "delete,
   * sharing, folder, dataset access, listing"). PLACEMENT only: `visibility` and
   * `access` above are on `canGovern`'s list too and this door has always let an
   * editor set them — refused above, on the same one ownership read this
   * shares. The read is what asks, so the ONE ownership rule stays
   * in SQL rather than being mirrored in JS here, and it is paid for only when
   * a placement or a governance field was actually asked for. The refusal is `invalid_parent`, which
   * already conflates "not a folder you may file into" — there is no second
   * code to learn, and it says nothing about whether the parent exists.
   */
  const placement = await placementFor(writerFor(current), parent, { id: current.id, format: current.format }, !!owned);
  if (placement instanceof Response) return placement;

  const changed = observedChange(current, expected);
  if (changed) return json(versionConflict(current, changed), 409);
  const htmlDatasets=await prepareHtmlDatasets(body,owner);if(htmlDatasets instanceof Response)return htmlDatasets;
  if (options.dryRun) return preflightReply(prepared);
  const htmlBackends=await prepareHtmlBackends(body);if(htmlBackends instanceof Response)return htmlBackends;
  const graphqlRefusal=await pageGraphqlRefusal(owner,body.html,htmlDatasets,htmlBackends);if(graphqlRefusal)return graphqlRefusal;
  const applied = await applyPreparedContent(prepared);
  parsed = applied;
  const input: ArtifactInput = {
    ...parsed,
    meta:{...parsed.meta,...(bundleSupplied?publicationRecord(bundleReceipts,bundleEntryPath):current.meta.htmlPublicationDependencies?publicationRecord(current.meta.htmlPublicationDependencies as unknown[],current.meta.htmlPublicationEntryPath):{})},
    ...(htmlBackends?{htmlBackends}:{}),
    ...(htmlDatasets?{htmlDatasets}:{}),
    ...(body.title===null || typeof body.title === 'string' ? { title: body.title } : parsed.format==='html'?{title:parsed.derivedTitle}:{}),
    ...(body.description===null || typeof body.description === 'string' ? { description: body.description } : parsed.format==='html'?{description:parsed.derivedDescription??null}:{}),
    ...(visibility ? { visibility } : {}),
    ...(placement ? { ancestor_ids: placement.ancestor_ids } : {}),
    ...(access ? { access } : {}),
    ...(link ? {link_role:link} : {}),
  };
  /*
   * A FOLDER'S WRITE IS THE METADATA WRITE — the PATCH door's, not a replace.
   *
   * Everything a folder takes is metadata (the content fields were refused
   * above), so there is nothing to archive and nothing to diff: routing it
   * through the replace door filed an archived copy of an empty state, wrote an
   * edit-log row and moved the version — the one number a caller reads to learn
   * that a document changed — for a rename. One code path (lib/artifacts
   * setMetadataFor) means the browser renaming a folder and an agent's
   * `update_artifact` are the same act, down to the trim on the title. The
   * observed version and state were already answered above, as for any write.
   */
  // Resolve advisory effects before the storage transaction so the exact wire reply
  // can be committed atomically without querying outside PGLite's transaction connection.
  const receiptOwner = await documentOwner(current);
  const receiptEffects=options.mutationReceipt?{
    warnings:[],
    affected:['dataset','image','pdf','file'].includes(input.format)?await findDependentsFor(actor,id):null,
  }:undefined;
  let row;
  try { row = current.format === 'folder'
    ? await setMetadataFor(actor, id, {
      ...(shares!==undefined?{shares}:{}),
      ...(body.title===null || typeof body.title === 'string' ? { title: body.title } : {}),
      ...(visibility ? { visibility } : {}),
      ...(placement ? { ancestor_ids: placement.ancestor_ids } : {}),
    }, {...expected,expectedSharingRevision})
    : await replaceArtifactFor(actor, id, input, {...expected,expectedSharingRevision,shares,...(options.mutationReceipt?{mutationReceipt:options.mutationReceipt,mutationReply:async(saved:ArtifactRow):Promise<MutationReply>=>({status:200,body:{...await replacedArtifactWire(saved,base,sentMarkup,{affected:receiptEffects?.affected??null,warnings:receiptEffects?.warnings??[],openAnnotations:committedOpenAnnotations(saved)},receiptOwner),...(bundleReceipts.length?{dependencyReceipts:bundleReceipts}:{})}})}:{})});
  } catch(error) {if(error instanceof ScheduleLimitError)return json({error:error.code,details:[error.message]},error.status);if(error instanceof DatasetError)return json({error:"dataset_error",details:[error.message]},error.status);throw error;}
  // A refusal the replace composed for itself — `policy_locked` (409) or
  // `policy_mismatch` (400). It exists so this door stops answering the
  // uniform 404 below for a governed dataset the caller is looking straight
  // at; it is already the answer, and is not re-worded here.
  if (row instanceof Response) return row;
  if (isVersionConflict(row)) { const {conflict:_conflict,...body}=row; return json(body, 409); }
  if (!row) return json({ error: 'not_found' }, 404);

  if(row.format==='html')void trackEvent('edit',row.id,{userId:actor.userId??null});

  // Dataset/viz refresh: warn about dependents whose bindings no longer
  // resolve (warnings, never blocks).
  const warnings = receiptEffects?receiptEffects.warnings:[];
  const affected = receiptEffects?receiptEffects.affected:['dataset','image','pdf','file'].includes(row.format) ? await findDependentsFor(actor,row.id) : null;
  return json({...await replacedArtifactWire(row, base, sentMarkup, { affected, warnings, openAnnotations: committedOpenAnnotations(row) },receiptOwner),...(bundleReceipts.length?{dependencyReceipts:bundleReceipts}:{})});
}

/**
 * The JSON create pipeline — one implementation for the bearer route and the
 * operations registry (lib/operations). The HTTP route keeps one
 * transport-only branch of its own: a raw `Content-Type: image/*` body, which
 * has no JSON envelope for this function to read.
 */
export async function createArtifactFromBody(body:Record<string,unknown>,actor:TokenHoldingActor,base:string,request?:Request,options:{dryRun?:boolean}={}):Promise<Response>{
 if(options.dryRun&&body.publicationBundle!==undefined)return json({error:'bundle_preflight_requires_dependency_plan'},400);
 const bundled=await preparePublicationBundle(body,actor,base,request,(dependency,dependencyRequest)=>createArtifactFromBody(dependency,actor,base,dependencyRequest),(dependencyId,input,key)=>updateBundleDependency(actor,base,dependencyId,input,key));
 if(bundled instanceof Response)return bundled;
 const response=await createArtifactFromBodyPrepared(bundled.body,actor,base,request,{...options,bundleReceipts:bundled.receipts,bundleEntryPath:bundled.entryPath});
 if(!bundled.receipts.length)return response;
 return json({...await response.json(),dependencyReceipts:bundled.receipts},response.status);
}

async function createArtifactFromBodyPrepared(
  body: Record<string, unknown>,
  actor: TokenHoldingActor,
  base: string,
  request?: Request,
  options: {dryRun?:boolean;bundleReceipts?:unknown[];bundleEntryPath?:string} = {},
): Promise<Response> {
  let destination;
  try{destination=parseArtifactDestination(body.destination);}catch(error){if(error instanceof DatasetError)return json({error:'invalid_destination',details:[error.message]},error.status);throw error;}
  if(body.reserved_id!==undefined&&(typeof body.reserved_id!=='string'||!ID_RE.test(body.reserved_id)))return json({error:'invalid_reserved_id'},400);
  if(Object.hasOwn(body,'policy')||Object.hasOwn(body,'expectedPolicyRevision'))return json({error:'combined_policy_write',hint:'Publish the dataset first, pull its YAML, then change its policy.'},400);
  // LINEAGE. A fork is made locally — a draft with the source's identity stripped
  // and `forked_from` recorded — and its FIRST create presents that id here. The
  // claim is checked, not trusted: provenance may only name a source this actor
  // can actually read, by the same rule `fork_artifact` and the export door use,
  // and unreachable is unknown. Written once at creation; no later write touches it.
  let forkedFrom: string | undefined;
  if (body.forked_from !== undefined && body.forked_from !== null) {
    if (typeof body.forked_from !== 'string' || !ID_RE.test(body.forked_from)) return json({ error: 'invalid_metadata', hint: 'forked_from is the id of the artifact this copy came from.' }, 400);
    const source = await getArtifactById(body.forked_from);
    if (!source || (!ownsArtifact(source,actor) && !(await canReadArtifact(source, actor)))) return json({ error: 'not_found', hint: 'forked_from must name an artifact you can read.' }, 404);
    forkedFrom = source.id;
  }
  let receiptOwner:UserPagesOwner|null = null;
  let responseBody: ((row: ArtifactRow) => Record<string,unknown>) = row => createdArtifactWire(row,base,body.markup,receiptOwner);
  let operation;
  try {operation = await creationOperation(actor,base,request?.headers.get('Idempotency-Key'),body,row=>({status:201,body:responseBody(row)}),request?.headers.get('X-Artifactbin-Account'));}
  catch(error){if(error instanceof LiveRegionRefusal)return json({error:error.code,details:error.details},409);if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);throw error;}
  if(operation){const replay=await lookupCreation(await getDb(),operation);if(replay)return json(replay.body,replay.status);}
  if (await artifactQuotaExceeded(actor.tokenId)) return json({ error: 'quota_exceeded', details: ['this token has hit its artifact COUNT quota — deleting does not free it (nothing is erased), so ask your user for another token'] }, 403);
  const shares=parseShareEntries(body.shares);if(shares instanceof Response)return shares;const boxed=await shareTargetsRefusal(actor,shares);if(boxed)return json({error:TEST_ACCOUNT_RESTRICTED,detail:boxed},403);
  if(body.visibility===null||body.linkRole===null)return json({error:'invalid_metadata',hint:'visibility and linkRole cannot be null.'},400);
  const link=parseLinkRoleValue(body.linkRole);if(link instanceof Response)return link;
  const parent = parseParentField(body);
  if (parent instanceof Response) return parent;
  // Nothing exists yet to be unreachable, so there is no ordering question
  // here: the parent is the only row being read, and it must be the caller's
  // own folder or this is the one refusal.
  const placement = (await placementFor(actor, parent, null)) ?? { ancestor_ids: [] };
  if (placement instanceof Response) return placement;
  try{destination=await newArtifactDestination(actor,destination,parent);}catch(error){if(error instanceof DatasetError)return json({error:'invalid_destination',details:[error.message]},error.status);throw error;}
  receiptOwner = await documentOwner({user_id:actor.userId,group_id:destination?.type==='group'?destination.id:null});
  // A group publishes as the group: the creating token, no account, the group as owner (never the actor's grant).
  const publicationActor:AccessActor=destination.type==='group'?{...identityForUser(null,actor.tokenId),groupId:destination.id}:actor;
  const sentMarkup=body.markup;
  const prepared = await prepareContentInput(body, {
    creating: true,
    prepareDataset: (input,objects) => prepareCatalog(input,undefined,objects),
    loadRef: refLoaderForActor(publicationActor),
    overByteQuota: byteQuotaFor(actor.tokenId),
  }, {allowRemoteInputs:!options.dryRun});
  if (prepared instanceof Response) return prepared;
  let parsed = prepared.content;
  const visibility = parseVisibility(body, !!actor.userId);
  if (visibility instanceof Response) return visibility;
  const access = parseAccessField(body, parsed.format);
  if (access instanceof Response) return access;
  const graphqlName=parseGraphqlName(body,parsed,forkedFrom);if(graphqlName instanceof Response)return graphqlName;

  const htmlDatasets=await prepareHtmlDatasets(body,publicationActor);if(htmlDatasets instanceof Response)return htmlDatasets;
  if (options.dryRun) return preflightReply(prepared);
  const htmlBackends=await prepareHtmlBackends(body,true);if(htmlBackends instanceof Response)return htmlBackends;
  const graphqlRefusal=await pageGraphqlRefusal(publicationActor,body.html,htmlDatasets,htmlBackends);if(graphqlRefusal)return graphqlRefusal;
  const applied = await applyPreparedContent(prepared);
  parsed = applied;
  responseBody = row => ({...createdArtifactWire(row,base,sentMarkup,receiptOwner)});
  let row;
  try{row = await createArtifact(actor.tokenId, actor.userId, {
    ...parsed,
    meta:{...parsed.meta,...(options.bundleReceipts?.length?publicationRecord(options.bundleReceipts,options.bundleEntryPath):{})},
    ...(htmlBackends?{htmlBackends}:{}),
    ...(htmlDatasets?{htmlDatasets}:{}),
    title: body.title===null || typeof body.title === 'string' ? body.title : parsed.derivedTitle,
    description: body.description===null || typeof body.description === 'string' ? body.description : parsed.derivedDescription??null,
    ...(visibility ? { visibility } : {}),
    ...(access ? { access } : {}),
    ancestor_ids: placement.ancestor_ids,
    destination,
  }, {reservedId:body.reserved_id as string|undefined,operation,shares,...(link?{linkRole:link}:{}),...(forkedFrom?{forkedFrom}:{}),...(graphqlName!==undefined?{graphqlName}:{})});}catch(error){if(error instanceof LiveRegionRefusal)return json({error:error.code,details:error.details},409);if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);if(error instanceof ScheduleLimitError)return json({error:error.code,details:[error.message]},error.status);if(error instanceof DatasetError)return json({error:'dataset_error',details:[error.message]},error.status);throw error;}
  return json(responseBody(row), 201);
}


/**
 * REFRESH — one pipeline, two doors (the `refresh_asset` operation and the
 * owner's menu row), because a bearer agent and a person clicking a menu must
 * not be able to mean different things by it.
 *
 * `url` refreshes one URL we hold. `id` refreshes every external URL a DOCUMENT
 * names that we hold a copy of — the shape a person actually wants ("this deck's
 * pictures are stale"), and the one an agent can call without first knowing
 * which URLs are in there. Publish copies nothing (a written URL is served as
 * written), so a copy exists only where a reader's view asked for one
 * (app/a/[id]/assets); a URL with no copy has nothing to refresh and is left
 * out of the report rather than named as a failure.
 * Reach for the document form is the WRITE scope, not the read one: refreshing
 * changes bytes every reader of every document naming that URL will see, so it
 * belongs to someone who may change the document, and the miss is the uniform
 * 404 that every other door answers.
 *
 * The hourly web-import allowance is the same bucket a publish spends
 * (lib/auth) and is charged PER URL inside `refreshWebAssets`, because these
 * are the same fetches: one call must not buy N of them for one slot. A url
 * that cannot be paid for comes back in `failed` as `rate_limited`, beside the
 * urls that could — a partial refresh is more useful than a refused one.
 */
export async function refreshAssetsFor(
  actor: AccessActor,
  input: { url?: unknown; id?: unknown },
): Promise<Response> {
  const url = typeof input.url === 'string' && input.url ? input.url : null;
  const id = typeof input.id === 'string' && input.id ? input.id : null;
  if (!url && !id) return json({ error: 'nothing_to_refresh', details: ['name a url, or the id of a document whose external urls should be refreshed'] }, 400);

  let urls: string[];
  let by: WebAssetImporter = actor;
  if (id) {
    const row = await getArtifactFor(actor, id);
    if (!row) return json({ error: 'not_found' }, 404);
    const named = row.format==='html' ? htmlAssetLinks(row.source ?? '').imageUrls : [];
    const held = await lookupWebAssets(named);
    urls = named.filter((u) => held.has(u));
    // The bytes belong to whoever the DOCUMENT belongs to, exactly as they did
    // when the view-time door imported them — an editor refreshing does not take them over.
    by = writerFor(row);
  } else {
    urls = [url!];
  }
  return json(await refreshWebAssets(urls, by));
}

function preflightReply(prepared:PreparedContent):Response {
  return json({valid:true,dry_run:true,markup:prepared.content.source,format:prepared.content.format,
    planned:{objects:prepared.objects.length},
    commit_checks:['authorization','quota','references','observed_state']});
}
