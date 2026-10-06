import { z } from 'zod';
import { datasetActor } from '@/lib/datasets/http';
import { ingestDataset, IngestError } from '@/lib/data-ingest';
import { readJson, json } from '@/lib/http';

const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('csv'), text: z.string() }),
  z.object({ kind: z.literal('sheetUrl'), url: z.string() }),
]);

/** Import into an editor draft: parsing/fetching only, no artifact or object writes. */
export async function POST(request: Request) {
  const actor = await datasetActor(request);
  if (actor instanceof Response) return actor;
  const parsed = source.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'invalid_dataset', details: ['Choose a CSV file or a public Google Sheets link.'] }, 400);
  try {
    return json(await ingestDataset(parsed.data));
  } catch (error) {
    if (error instanceof IngestError) return json({ error: 'invalid_dataset', code: error.code, details: [error.message] }, 400);
    throw error;
  }
}
