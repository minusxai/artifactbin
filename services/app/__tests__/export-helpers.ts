import {expect} from 'vitest';
import {GET} from '@/app/a/[id]/export/route';
import {exportAssetResponse} from '@/lib/export';
import {createArtifactFromBody} from '@/lib/publish';
import {storePolicy} from '@/__tests__/artifact-fixtures';
export const EXPORT_PNG=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64'));
/** Follow the real redirect through the real asset handler; failures and editor previews stay direct. */
export async function exportImage(request:Request,context:Parameters<typeof GET>[1]):Promise<Response>{
 const response=await GET(request,context);
 if(response.status!==302)return response;
 expect(response.headers.get('cache-control')).toBe('no-store');
 const url=new URL(response.headers.get('location')!);
 expect(url.pathname).toMatch(/^\/assets\/export\//);
 return exportAssetResponse(new Request(url),url.pathname.split('/').at(-1)!);
}

export const STAFF = [{ name: 'ada', team: 'red' }, { name: 'bo', team: 'blue' }];
/** Signed-in readers see every column; anonymous readers see names only. */
export const ROWS = { schema: 'public', name: 'rows' };
const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
    { role: 'anonymous', permission: { columns: ['name'], filter: {} } },
  ],
  insert_permissions: [{ role: 'signed_in', permission: { columns: ['name', 'team'], check: {} } }],
}] };

/** A deck page and the STAFF dataset (under POLICY) it reads, both at `visibility`. */
export async function staffDeck(owner: Parameters<typeof createArtifactFromBody>[1], visibility: 'private' | 'unlisted') {
  const dataset = await createArtifactFromBody({ dataset: STAFF, title: 'Staff', access: 'readwrite', visibility }, owner, 'http://localhost:3000');
  expect(dataset.status).toBe(201);
  const staff = (dataset.body as { id: string }).id;
  await storePolicy(staff, POLICY);
  const html = `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff}"></head><body><main id="deck"></main></body></html>`;
  const page = await createArtifactFromBody({ html, visibility }, owner, 'http://localhost:3000');
  expect(page.status).toBe(201);
  return { page: (page.body as { id: string }).id, staff };
}

/** The runtime configuration a served page carries. */
export const runtime = (html: string) => JSON.parse(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/.exec(html)![1]!) as { domainReads?: true; revision: string };
