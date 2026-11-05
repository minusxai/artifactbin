/**
 * Agents on a page's live regions (lib/region-sessions agents.ts; contract region-sessions): read a region's text as
 * Markdown or HTML (with people's unsaved typing), write it back from the version read while people type in it, and
 * save everyone's unsaved typing as a version on purpose. `_doc` names a doc's one rich region.
 */
import { z } from 'zod';
import { DOC_REGION, type RegionFormat } from '@artifactbin/contracts';
import { agentRegions, type AgentRegions, type RegionAnswer } from '@/lib/region-sessions';
import { getDb } from '@/lib/platform';
import type { Operation, OpReply } from './registry';

let regions: AgentRegions | undefined;
const store = (): AgentRegions => (regions ??= agentRegions(getDb, () => Date.now()));

const asReply = <T extends object>(answer: RegionAnswer<T>): OpReply =>
  answer.status === 200 ? { status: 200, body: { ...answer.body } as Record<string, unknown> } : { status: answer.status, body: { error: 'not_found', ...answer.body } };

const NOT_FOUND = { status: 404, code: 'not_found', fix: 'the id is wrong OR this token cannot reach it (writes need edit access): existence is never revealed' };
const REGION_NOT_FOUND = { status: 404, code: 'region_not_found', fix: `name one of the regions the reply lists (\`regions\`), or ${DOC_REGION} for a doc's one rich region` };
const AMBIGUOUS = { status: 409, code: 'region_ambiguous', fix: `the page has several rich regions: name one from \`regions\` instead of ${DOC_REGION}` };
const TEXT_FORMATS: readonly RegionFormat[] = ['markdown', 'html'];
const region = z.string().describe(`A region's data-af-id, or ${DOC_REGION} for the page's only rich region (a doc's text).`);

const readRegionOp: Operation = {
  name: 'read_region',
  title: 'Read a live region',
  http: { method: 'GET', path: '/api/artifacts/{id}/regions/{regionId}' },
  description: `Read one editable region (data-af-editable) of a page as Markdown (default) or HTML, with the saved version it is from; ${DOC_REGION} is a doc's text. It holds people's unsaved typing: with edit access the read first saves that typing as a version (the version it answers), so pass that version as base_version to write_region and nothing anyone typed is applied twice.`,
  input: { id: z.string(), regionId: region, format: z.enum(TEXT_FORMATS as [RegionFormat, ...RegionFormat[]]).optional() },
  annotations: { readOnly: true },
  example: { input: { id: 'aB3xK9', regionId: DOC_REGION } },
  errors: [NOT_FOUND, REGION_NOT_FOUND, AMBIGUOUS],
  async run(ctx, input) {
    // The region's text representation (never a page format): Markdown unless HTML is asked for.
    const format = input.format ?? TEXT_FORMATS[0];
    if (!TEXT_FORMATS.includes(format as RegionFormat)) return { status: 400, body: { error: 'invalid_format' } };
    return asReply(await store().read(ctx.actor, String(input.id), String(input.regionId), format as RegionFormat));
  },
};

const writeRegionOp: Operation = {
  name: 'write_region',
  title: 'Write a live region',
  http: { method: 'PUT', path: '/api/artifacts/{id}/regions/{regionId}' },
  description: 'Replace one editable region\'s text while people may be typing in it: send the whole edited region as markdown (or html) and base_version, the version read_region returned. Your changes are merged with everyone\'s unsaved typing (nothing of theirs is lost), shown live to open editors and saved as a new version; the reply holds that version and the merged region. Never send whole-page HTML to change a doc people are editing.',
  input: { id: z.string(), regionId: region, markdown: z.string().optional(), html: z.string().optional(), base_version: z.number().int().positive() },
  annotations: { idempotent: true },
  example: { input: { id: 'aB3xK9', regionId: DOC_REGION, markdown: '# Plan\n\nShip on Friday.', base_version: 3 } },
  errors: [
    NOT_FOUND, REGION_NOT_FOUND, AMBIGUOUS,
    { status: 400, code: 'invalid_region_write', fix: 'send exactly one of markdown or html, and base_version from read_region' },
    { status: 409, code: 'region_snapshot_missing', fix: 'base_version is too old or unknown: read_region again (its version) and reapply your edit to that text' },
    { status: 413, code: 'too_large', fix: 'the merged region is over the size limit: split the text across pages' },
    { status: 422, code: 'unsupported_content', fix: 'details names what the region cannot hold (images, tables, line breaks, raw HTML elements): remove it and resend' },
  ],
  async run(ctx, input) {
    const markdown = typeof input.markdown === 'string' ? input.markdown : undefined, html = typeof input.html === 'string' ? input.html : undefined;
    const base = input.base_version;
    if ((markdown === undefined) === (html === undefined) || typeof base !== 'number' || !Number.isSafeInteger(base) || base < 1) return { status: 400, body: { error: 'invalid_region_write' } };
    const request = markdown !== undefined ? { markdown, baseVersion: base } : { html: html!, baseVersion: base };
    return asReply(await store().write(ctx.actor, String(input.id), String(input.regionId), request, { ...(ctx.mutationReceipt ? { receipt: ctx.mutationReceipt } : {}) }));
  },
};

const saveRegionsOp: Operation = {
  name: 'save_regions',
  title: 'Save live regions',
  http: { method: 'POST', path: '/api/artifacts/{id}/regions/flush' },
  description: 'Save everyone\'s unsaved typing in a page\'s live regions as one new version (edit access), and answer the version that holds it: a checkpoint in history (reads already include unsaved typing). Nothing unsaved answers the current version.',
  input: { id: z.string() },
  annotations: {},
  example: { input: { id: 'aB3xK9' } },
  errors: [NOT_FOUND],
  async run(ctx, input) {
    return asReply(await store().save(ctx.actor, String(input.id)));
  },
};

export const REGION_OPERATIONS: Operation[] = [readRegionOp, writeRegionOp, saveRegionsOp];
