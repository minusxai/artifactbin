import { getDb } from '@/lib/db';

export async function throttlePublicMutation(datasetId: string) {
  const db = await getDb();
  const bucket = `mutation:${datasetId}:${Math.floor(Date.now() / 60000)}`;
  const result = await db.query(
    `INSERT INTO dataset_usage(bucket,calls) VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET calls=dataset_usage.calls+1 WHERE dataset_usage.calls<30 RETURNING calls`,
    [bucket],
  );
  if (!result.rows.length)
    throw new Error('Public mutation limit reached; try again in a minute.');
}
