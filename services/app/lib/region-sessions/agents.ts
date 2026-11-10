/**
 * AGENTS ON LIVE REGIONS (contract: region-sessions RegionContentReply, RegionWriteRequest, RegionWriteReply): an
 * agent reads a region's text as Markdown or HTML and writes it back while people type in it.
 *
 *   read   the region as the page reads now (anyone who may read the page reads what it shows them). For someone who
 *          may edit it (who may write back), unsaved typing is first saved as a version (a checkpoint, lib/artifacts
 *          checkpointLiveRegions), and the region is read at that saved head: its version is then a base that holds
 *          exactly the text read, so the write's three-way merge never applies others' unsaved typing a second time.
 *          A reader, who cannot write, reads the current page (lib/artifacts current-page) at the saved version.
 *   write  made from a version the agent read (`baseVersion`): merged three-way from that version's snapshot into
 *          the live state (lib/live-regions applyRegionRevision), so people's unsaved typing survives; logged as
 *          the agent's update and woken to the editors' streams, then saved as one new version with everyone's
 *          typing, in the same transaction (the editors' streams send the update before the `saved`).
 *
 * `_doc` (DOC_REGION) names the page's only rich region. Locks as every page write: the artifacts row FOR UPDATE
 * first (so the save never upgrades a lock), then the region row.
 */
import * as Y from 'yjs';
import { canEdit, DOC_REGION, type RegionContentReply, type RegionFlushReply, type RegionFormat, type RegionWriteReply } from '@artifactbin/contracts';
import { applyRegionRevision, editableRegions, isRegionId, LiveRegionRefusal, regionMarkdown, validateRegionState, type PageRegion } from '@/lib/live-regions';
import { checkpointLiveRegions, completeMutationReceipt, currentPage, editablePage, liveRegionDoc, logRegionUpdate, notifyRegions, readableArtifact, saveLiveRegionsInTx, type MutationReceipt } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import { ID_RE, type Db } from '@/lib/platform';
import { NOT_FOUND, refuse, regionRow, regionStore, type RegionAnswer } from './sessions';

interface RegionWrite {
  /** Exactly one of markdown and html. */
  markdown?: string;
  html?: string;
  baseVersion: number;
}

export interface AgentRegions {
  read(actor: AccessActor, artifactId: string, regionId: string, format: RegionFormat): Promise<RegionAnswer<RegionContentReply>>;
  /** With a receipt (an Idempotency-Key), the reply is recorded in the write's own transaction. */
  write(actor: AccessActor, artifactId: string, regionId: string, request: RegionWrite, options?: { receipt?: MutationReceipt }): Promise<RegionAnswer<RegionWriteReply>>;
  /** Saves every region's unsaved typing as one version (the flush), so a read includes it. */
  save(actor: AccessActor, artifactId: string): Promise<RegionAnswer<RegionFlushReply>>;
}

const listed = (regions: PageRegion[]) => regions.map((region) => ({ regionId: region.id, kind: region.kind }));

/** The region a path names among the saved page's, or the refusal (naming the regions there are). */
function target(regions: PageRegion[], regionId: string): PageRegion | RegionAnswer<never> {
  if (regionId !== DOC_REGION) return regions.find((region) => region.id === regionId) ?? refuse('region_not_found', { regions: listed(regions) });
  const rich = regions.filter((region) => region.kind === 'rich' || region.kind === 'rich-native-v1');
  if (rich.length === 1) return rich[0]!;
  return refuse(rich.length ? 'region_ambiguous' : 'region_not_found', { regions: listed(regions) });
}
const isRegion = (value: PageRegion | RegionAnswer<never>): value is PageRegion => 'inner' in value;
const pathOk = (artifactId: string, regionId: string) => ID_RE.test(artifactId) && (regionId === DOC_REGION || isRegionId(regionId));

function isEmptyUpdate(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  return !structs.length && ![...ds.clients.values()].some((ranges) => ranges.length);
}

export function agentRegions(db: () => Promise<Db>, now: () => number): AgentRegions {
  const store = regionStore(db, now);
  return {
    save: (actor, artifactId) => store.flush(actor, artifactId),
    async read(actor, artifactId, regionId, format) {
      if (!pathOk(artifactId, regionId)) return NOT_FOUND;
      // A checkpoint first when this actor may edit (it saves nothing for a reader); then the page as it reads now.
      await checkpointLiveRegions(actor, artifactId);
      const readable = await readableArtifact(actor, artifactId);
      if (!readable || readable.row.format !== 'html') return NOT_FOUND;
      const page = canEdit(readable.role) ? readable.row : (await currentPage(readable.row)).row;
      const region = target(editableRegions(page.source ?? ''), regionId);
      if (!isRegion(region)) return region;
      const content = format === 'html' ? { html: region.inner } : { markdown: regionMarkdown(region.kind, region.inner) };
      return { status: 200, body: { regionId: region.id, kind: region.kind, version: readable.row.version, ...content } };
    },

    async write(actor, artifactId, regionId, request, options = {}) {
      if (!pathOk(artifactId, regionId)) return NOT_FOUND;
      const revised = request.markdown !== undefined ? { markdown: request.markdown } : { html: request.html ?? '' };
      try {
        return await (await db()).transaction(async (tx): Promise<RegionAnswer<RegionWriteReply>> => {
          const page = await editablePage(tx, actor, artifactId, { lock: 'update', source: true });
          if (!page || page.format !== 'html') return NOT_FOUND;
          const region = target(editableRegions(page.source ?? ''), regionId);
          if (!isRegion(region)) return region;
          const row = await regionRow(tx, artifactId, page.version, region);
          const stale = refuse('region_snapshot_missing', { version: page.version });
          const saved = (await tx.query<{ snapshot: Uint8Array }>(
            'SELECT snapshot FROM region_snapshots WHERE artifact_id = $1 AND region_id = $2 AND version = $3', [artifactId, region.id, request.baseVersion],
          )).rows[0];
          if (!saved) return stale;
          const doc = await liveRegionDoc(tx, artifactId, row);
          let update: Uint8Array;
          try { ({ update } = applyRegionRevision({ kind: row.kind, live: Y.encodeStateAsUpdate(doc), savedSnapshot: saved.snapshot, ...revised })); }
          catch (error) {
            if (!(error instanceof LiveRegionRefusal)) throw error;
            return error.code === 'unsupported_content' ? refuse('unsupported_content', { details: [...error.details] }) : stale;
          }
          if (!isEmptyUpdate(update)) {
            Y.applyUpdate(doc, update);
            try { validateRegionState(row.kind,doc); } catch(error) { if(error instanceof LiveRegionRefusal)return refuse(error.code==='too_large'?'too_large':'unsupported_content'); throw error; }
            const seq = row.last_seq + 1;
            const at = new Date(now()).toISOString();
            await logRegionUpdate(tx, artifactId, region.id, seq, Y.decodeUpdate(update).structs[0]?.id.client ?? 0, update, actor);
            await tx.query(
              'UPDATE region_states SET last_seq = $3, last_update_at = $4, dirty_since = COALESCE(dirty_since, $4) WHERE artifact_id = $1 AND region_id = $2',
              [artifactId, region.id, seq, at],
            );
            await notifyRegions(tx, artifactId, `${region.id}:${seq}`);
          }
          const save = await saveLiveRegionsInTx(tx, actor, artifactId);
          if (!save) return NOT_FOUND;
          const head = await editablePage(tx, actor, artifactId, { source: true });
          const html = editableRegions(head?.source ?? '').find((candidate) => candidate.id === region.id)?.inner ?? '';
          const body: RegionWriteReply = { regionId: region.id, kind: region.kind, version: save.version, html, ...(revised.markdown !== undefined ? { markdown: regionMarkdown(region.kind, html) } : {}) };
          if (options.receipt) await completeMutationReceipt(tx, options.receipt, { status: 200, body: { ...body } });
          return { status: 200, body };
        });
      } catch (error) {
        if (error instanceof LiveRegionRefusal) return error.code === 'unsupported_content' ? refuse('unsupported_content', { details: [...error.details] }) : refuse('region_snapshot_missing');
        throw error;
      }
    },
  };
}
