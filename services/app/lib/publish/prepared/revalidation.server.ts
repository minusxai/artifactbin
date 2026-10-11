/**
 * THE DOCUMENT'S VALIDATOR — the ETag a document page answers with, decided BEFORE anything is rendered
 * (lib/http/revalidation says how it is used; app/a/[id]/raw answers 304 from it).
 *
 * It has to name every input of the bytes. The route names what it decides itself (who is asking and in what role,
 * what they trust, the surface, the address); this adds what the STORED page and the data it starts from decide:
 *  - the prepared page and the compile it runs (their build, module and stylesheet versions — a background restyle or
 *    recompile of an unchanged version changes the bytes), and the live build and sources (a deploy);
 *  - the guest snapshot the story is rendered with (the same lookup `compiledPageFor` makes: a stored snapshot is
 *    served while it is fresh or young, so its time names it; a cold one is its own state);
 *  - the stored Mermaid drawings of this surface (a harvest lands after the version was prepared);
 *  - the imports this reader may hold (the page's `hold`, which a grant on a dataset changes without touching the document).
 * Not the bytes: that is the work a 304 exists not to do.
 *
 * Null when the stored page is not one `compiledPageFor` serves as it is (no compile, a recorded failure, below the
 * compatibility minimum): the answer is then made, and sent without a validator.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ArchivedRender, ArtifactRow } from '@/lib/artifacts';
import type { RoleActor } from '@/lib/accounts';
import { type DataPlan, isCompileFailure, loadCompilerBuild, MIN_HANDOVER_CONTRACT, MIN_PAGE_FORMAT, planOf } from '@/lib/compiled-page';
import { holdableImports } from '@/lib/document-data';
import { readUrlValues } from '@/lib/dataflow';
import { storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { mermaidImagesForCodes } from '@/lib/mermaid-images/store';
import { etagOf } from '@/lib/http/revalidation';
import type { PreparedView } from './prepared-page.server';
import { preparedCssVersion } from './css-version.server';
import { SNAPSHOT_MAX_AGE_MS, anonymousAccessFacts, snapshotKeyFor, snapshotStore } from './snapshots.server';

export interface DocumentEtagInput {
  /** The row this request renders (the head, or an archived version's bytes on it) and the head it came from. */
  row: ArtifactRow;
  artifact: ArtifactRow;
  at: ArchivedRender | null;
  /** The version's shell and its compile: the tree is not read to name a validator. */
  page: PreparedView<{ compiled: true }>;
  /** Whether the stored page was prepared under an older stylesheet (served as stored, re-prepared in the background). */
  stale?: boolean;
  /** The request's query string: the reader's `$` values. */
  search: string;
  /** Which stored Mermaid drawings this surface shows, or none (`CompiledReaderRequest.drawings`). */
  drawings: 'document' | 'inline' | null;
  /** The reader whose holdings the page's engine answers for, or undefined when the page holds nothing (`CompiledReaderRequest.holder`). */
  holder: RoleActor | null | undefined;
  /** Everything else the route decides about the answer: reader, role, trust, surface, addresses. Opaque here. */
  facts: unknown;
}

// eslint-disable-next-line no-restricted-syntax -- the sources fingerprint is a build artifact read once per process
let sources: string | null = null;
/** The fingerprint of the sources a prepared page is made by (the same file `prepared_pages.compiler_version` stores). */
function sourceFingerprint(): string {
  if (sources === null) {
    try { sources = readFileSync(path.join(process.cwd(), 'lib/build-assets', 'prepared-sources.sha256'), 'utf8').trim(); } catch { sources = ''; }
  }
  return sources;
}

/** What the code a page is made by is: the live island build, the prepared sources and the stylesheet environment. For any validator over a prepared page's output. */
export function codeFingerprint(): string[] {
  let live = '';
  try { live = loadCompilerBuild().id; } catch { /* a process with no island build has no compiled pages either */ }
  return [live, sourceFingerprint(), preparedCssVersion(), storyCssCompileVersion()];
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** What the guest snapshot lookup `compiledPageFor` makes will find, named: its key and the time it was computed, or the cold path. */
async function snapshotIdentity(input: DocumentEtagInput, plan: DataPlan, values: ReturnType<typeof readUrlValues>): Promise<string> {
  const { row, page } = input;
  const flow = page.declared?.flow;
  if (!flow || !plan.queries.some((q) => q.scope === 'shared') || row.visibility === 'private') return 'none';
  const key = snapshotKeyFor(row.id, 'head', plan, values);
  const read = await snapshotStore.get(key);
  if (read?.fresh) return `fresh:${read.snapshot.computedAt}`;
  if (read && Date.now() - read.snapshot.computedAt <= SNAPSHOT_MAX_AGE_MS) {
    // Stale but young: served only while the guest's access derives the same plan (compiledPageFor snapshotFor).
    const current = planOf(flow, await anonymousAccessFacts(row, flow));
    return snapshotKeyFor(row.id, 'head', current, values).planKey === key.planKey ? `young:${read.snapshot.computedAt}` : 'cold';
  }
  return 'cold';
}

export async function documentEtag(input: DocumentEtagInput): Promise<string | null> {
  const { row, artifact, at, page } = input;
  const stored = page.compiled;
  if (!stored || isCompileFailure(stored) || page.pageFormat < MIN_PAGE_FORMAT || page.handoverContract < MIN_HANDOVER_CONTRACT) return null;
  try { loadCompilerBuild(); } catch { return null; }

  const flow = page.declared?.flow ?? null;
  const failedState = !!page.declared?.state && Object.keys(page.declared.state.errors).length > 0;
  const values = flow ? readUrlValues(input.search, flow) : {};
  const [snapshot, mermaid, hold] = await Promise.all([
    stored.plan && flow && !at && !failedState ? snapshotIdentity(input, stored.plan, values) : Promise.resolve('none'),
    input.drawings
      ? mermaidImagesForCodes({ artifactId: row.id, version: at?.version ?? row.version, surface: input.drawings, head: !at, visibility: row.visibility }, page.mermaidCodes).then(digest)
      : Promise.resolve(''),
    flow && input.holder !== undefined ? holdableImports(row, flow, input.holder) : Promise.resolve([] as string[]),
  ]);

  return etagOf({
    v: 1,
    facts: input.facts,
    row: [row.id, row.version, row.title, row.description, row.visibility, artifact.edit_id, artifact.updated_at, artifact.link_role, at?.version ?? null],
    page: [page.cssVersion ?? null, page.pageFormat, page.handoverContract, !!input.stale],
    compile: [stored.build, stored.module?.sha ?? null, stored.ssr?.sha ?? null, stored.sharedBuild?.id ?? null],
    code: codeFingerprint(),
    data: [snapshot, mermaid, hold],
    values,
  });
}
