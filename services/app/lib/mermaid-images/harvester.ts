/**
 * THE HARVESTER (lib/mermaid-images/store has the whole story): claims a
 * queued version under a fenced lease, has the browser service draw it on each
 * reader surface in each mode with the engine forced, and stores what may be
 * stored. Started by a composition root only — never on import.
 */
import { randomUUID } from 'node:crypto';
import type { HarvestedSvg, SvgHarvestRequest } from '@artifactbin/contracts';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';
import { getDb } from '@/lib/db';
import { services } from '@/lib/services';
import { objectStore } from '@/lib/object-store';
import { ASSETS_ORIGIN, EXPORT_INTERNAL_ORIGIN } from '@/lib/config';
import { mintExportKey } from '@/lib/export-key';
import { storyBodyFor } from '@/lib/story/body';
import { getArtifactById } from '@/lib/artifacts';
import { servedRow } from '@/lib/archived-version';
import { MERMAID_RENDER_ENGINE, mermaidPrerenderable } from './engine';
import { mermaidCodesOf } from './codes';
import { sanitizeMermaidSvg } from './sanitize';
import { CAPTURE_COLOR_PARAM, MERMAID_ENGINE_PARAM, MERMAID_MODES, MERMAID_SURFACES, mermaidContentKey, mermaidObjectKey, onMermaidHarvestQueued, type MermaidHarvestMap, type MermaidImageInfo, type MermaidMode, type MermaidSurface } from './store';

type Mode = MermaidMode;
type HarvestMap = MermaidHarvestMap;
type ImageInfo = MermaidImageInfo;
const MODES = MERMAID_MODES;
const objectKeyFor = mermaidObjectKey;

const MAX_ATTEMPTS = 6;
const LEASE_MS = 180_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 3_600_000;
const HARVEST_TIMEOUT_MS = 45_000;

class HarvestUnavailable extends Error {}

/** The page a harvest loads: the version, on one surface, in one mode, with the engine forced. */
function harvestRequest(artifactId: string, surface: MermaidSurface, mode: Mode): SvgHarvestRequest {
  const key = mintExportKey(artifactId);
  const query = `key=${key}&${MERMAID_ENGINE_PARAM}=engine&${CAPTURE_COLOR_PARAM}=${mode}`;
  const url = new URL(surface === 'document' ? `/a/${artifactId}/raw?chrome=0&${query}` : `/a/${artifactId}?${query}`, EXPORT_INTERNAL_ORIGIN).toString();
  return {
    url, viewport: { width: 1440, height: 1000 }, selector: 'body',
    // Only what the ENGINE drew here carries its palette (components/kit/mermaid).
    collect: 'figure[data-mx-mermaid-palette][data-mx-mermaid-key]',
    sameOriginOnly: true, ...(ASSETS_ORIGIN ? { assetOrigin: ASSETS_ORIGIN } : {}),
    settleMs: 100, timeoutMs: HARVEST_TIMEOUT_MS, loads: 1,
  };
}

async function harvestLoad(artifactId: string, surface: MermaidSurface, mode: Mode): Promise<HarvestedSvg[]> {
  const browser = services().browser;
  if (!browser.harvestSvg) throw new HarvestUnavailable('no harvest operation');
  const result = await browser.harvestSvg(harvestRequest(artifactId, surface, mode));
  if (result.ok) return result.loads[0] ?? [];
  // The detail may quote the page URL: its signed key never reaches a log.
  const detail = 'detail' in result && result.detail ? `: ${result.detail.replace(/key=[^&\s"']+/g, 'key=…').slice(0, 300)}` : '';
  throw result.reason === 'harvest_unavailable' || result.reason === 'unavailable' ? new HarvestUnavailable(result.reason) : new Error(`harvest ${result.reason} on ${surface}/${mode}${detail}`);
}

/** Ids are the one thing two loads of one drawing may number differently. */
const comparable = (svg: string) => svg.replace(/mx-mermaid-\d+/g, 'mx-mermaid-N');

interface Candidate { surface: MermaidSurface; mode: Mode; imageKey: string; code: string; palette: string; type: string; width: number | null; height: number | null; svg: string; content: string }

/** What one load drew that this version draws, may be stored and is inert. */
function candidatesOf(drawn: HarvestedSvg[], surface: MermaidSurface, mode: Mode, expected: Map<string, string>): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const drawing of drawn) {
    const imageKey = drawing.attributes['data-mx-mermaid-key'] ?? '';
    const palette = drawing.attributes['data-mx-mermaid-palette'] ?? '';
    const type = drawing.attributes['data-mermaid-type'] ?? '';
    const code = expected.get(imageKey);
    // The same code twice on one page takes its first drawing.
    if (!code || !imageKey.startsWith(`${mode}-`) || seen.has(imageKey)) continue;
    if (!/^[0-9a-f]{32}$/.test(palette) || !/^[\w.-]{1,64}$/.test(type)) continue;
    const svg = sanitizeMermaidSvg(drawing.svg);
    if (!svg) continue;
    seen.add(imageKey);
    out.push({ surface, mode, imageKey, code, palette, type, width: drawing.width, height: drawing.height, svg, content: mermaidContentKey(mode, palette, code) });
  }
  return out;
}

/** Harvest one claimed version; the answer is the job's `images`, or null when the version is no longer the head. */
async function harvestVersion(artifactId: string, version: number): Promise<HarvestMap | null> {
  const row = await getArtifactById(artifactId);
  if (!row || row.format !== 'markup' || row.version !== version) return null;
  const served = await servedRow(row, null);
  const nodes = storyBodyFor(served.source ?? '')?.body ?? [];
  const codes = mermaidCodesOf(nodes).filter(mermaidPrerenderable);
  const images: HarvestMap = {};
  if (!codes.length) return images;
  const db = await getDb();
  for (const surface of MERMAID_SURFACES) {
    for (const mode of MODES) {
      const expected = new Map(codes.map((code) => [mermaidImageKey(code, mode), code]));
      const candidates = candidatesOf(await harvestLoad(artifactId, surface, mode), surface, mode, expected);
      if (!candidates.length) continue;
      const known = new Set((await db.query<{ key: string }>('SELECT key FROM mermaid_images WHERE key=ANY($1::text[])', [candidates.map((c) => c.content)])).rows.map((r) => r.key));
      // A drawing never stored before must come out the same from a second, fresh load.
      const fresh = candidates.filter((c) => !known.has(c.content));
      let again = new Map<string, HarvestedSvg>();
      if (fresh.length) again = new Map((await harvestLoad(artifactId, surface, mode)).map((d) => [d.attributes['data-mx-mermaid-key'] ?? '', d]));
      for (const candidate of candidates) {
        if (!known.has(candidate.content)) {
          const second = again.get(candidate.imageKey);
          if (!second || second.attributes['data-mx-mermaid-palette'] !== candidate.palette || comparable(second.svg) !== comparable(candidate.svg)) continue;
          await objectStore().put(objectKeyFor(candidate.content), candidate.svg, 'image/svg+xml');
          const info: ImageInfo = { type: candidate.type, mode, palette: candidate.palette, ...(candidate.width !== null ? { width: candidate.width } : {}), ...(candidate.height !== null ? { height: candidate.height } : {}) };
          await db.query('INSERT INTO mermaid_images(key,engine,object_key,bytes,info) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING',
            [candidate.content, MERMAID_RENDER_ENGINE, objectKeyFor(candidate.content), Buffer.byteLength(candidate.svg), JSON.stringify(info)]);
        }
        (images[surface] ??= {})[candidate.imageKey] = candidate.content;
      }
    }
  }
  return images;
}

/**
 * Claim the next due job and run it. True when a job was run (so the caller
 * looks for another), false when none is due. Never throws.
 */
export async function runNextMermaidHarvest(): Promise<boolean> {
  const db = await getDb();
  const token = randomUUID();
  const claimed = (await db.query<{ artifact_id: string; version: number; attempts: number }>(`
    UPDATE mermaid_harvests SET claim_token=$1, lease_until=clock_timestamp()+$2::int*interval '1 millisecond', attempts=attempts+1, updated_at=now()
    WHERE (artifact_id,version,engine) = (
      SELECT artifact_id,version,engine FROM mermaid_harvests
      WHERE state='pending' AND engine=$3 AND (lease_until IS NULL OR lease_until<=clock_timestamp())
        AND (retry_after IS NULL OR retry_after<=clock_timestamp())
      ORDER BY created_at LIMIT 1)
    AND (lease_until IS NULL OR lease_until<=clock_timestamp())
    RETURNING artifact_id,version,attempts`, [token, LEASE_MS, MERMAID_RENDER_ENGINE])).rows[0];
  if (!claimed) return false;
  const settle = (state: string, images: HarvestMap | null) => db.query(
    `UPDATE mermaid_harvests SET state=$4,images=$5::jsonb,claim_token=NULL,lease_until=NULL,retry_after=NULL,updated_at=now()
     WHERE artifact_id=$1 AND version=$2 AND engine=$3 AND claim_token=$6`,
    [claimed.artifact_id, claimed.version, MERMAID_RENDER_ENGINE, state, images === null ? null : JSON.stringify(images), token]);
  try {
    const images = await harvestVersion(claimed.artifact_id, claimed.version);
    await settle(images === null ? 'superseded' : 'done', images);
  } catch (error) {
    const last = claimed.attempts >= MAX_ATTEMPTS;
    const delay = Math.min(RETRY_BASE_MS * 2 ** (claimed.attempts - 1), RETRY_MAX_MS);
    if (!(error instanceof HarvestUnavailable)) console.warn(`[mermaid] harvest failed (attempt ${claimed.attempts}):`, (error as Error).message);
    await db.query(
      `UPDATE mermaid_harvests SET state=$4,claim_token=NULL,lease_until=NULL,retry_after=clock_timestamp()+$5::int*interval '1 millisecond',updated_at=now()
       WHERE artifact_id=$1 AND version=$2 AND engine=$3 AND claim_token=$6`,
      [claimed.artifact_id, claimed.version, MERMAID_RENDER_ENGINE, last ? 'failed' : 'pending', delay, token]).catch(() => {});
  }
  return true;
}

/*
 * THE HARVESTER, per process. Nothing runs until a composition root starts it
 * (server.ts, server/host.ts): the test suite's browser has no harvest, and a
 * module import must never launch Chromium. Started, it drains due jobs when a
 * job is queued (`kick`) and on a slow tick (retries, jobs another process
 * queued, jobs left by a restart). One drain at a time; the lease fences
 * processes from each other.
 */
let draining: Promise<void> | null = null;
let started = false;
function kick(): void {
  if (!started || draining) return;
  draining = (async () => {
    try { while (started && await runNextMermaidHarvest()); }
    catch (error) { console.warn('[mermaid] harvester:', (error as Error).message); }
    finally { draining = null; }
  })();
}

export function startMermaidHarvester(options: { intervalMs?: number } = {}): () => Promise<void> {
  started = true;
  onMermaidHarvestQueued(kick);
  const timer = setInterval(kick, options.intervalMs ?? 15_000);
  timer.unref();
  kick();
  return async () => { started = false; onMermaidHarvestQueued(null); clearInterval(timer); await draining; };
}
