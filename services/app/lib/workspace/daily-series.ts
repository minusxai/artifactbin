/** UTC daily buckets, oldest first. Rows outside the requested window are ignored. */
export function dailySeries(
  rows: readonly { artifact_id: string; day: string; n: number }[],
  days: number,
  now = new Date(),
): Map<string, number[]> {
  const today = Date.parse(now.toISOString().slice(0, 10));
  const series = new Map<string, number[]>();
  for (const row of rows) {
    const age = Math.round((today - Date.parse(row.day)) / 86_400_000);
    const index = days - 1 - age;
    if (index < 0 || index >= days) continue;
    const buckets = series.get(row.artifact_id) ?? new Array<number>(days).fill(0);
    buckets[index] = row.n;
    series.set(row.artifact_id, buckets);
  }
  return series;
}
