import type { Dataflow } from '@/lib/story/dataflow';
import { ARTIFACT_FILE_FORMAT, type ArtifactFile } from '../file-format';

/** A dashboard with one filter (`region`, three options) feeding `sales`, and `regions` which reads no Value. */
export const flow: Dataflow = {
  values: [{ kind: 'scalar', name: 'region', type: 'string', default: null, start: 0, end: 0 }],
  queries: [
    { name: 'regions', sql: 'select distinct region from public.rows', params: [], refs: [], start: 0, end: 0 },
    { name: 'sales', sql: 'select sum(revenue) as revenue from public.rows where $region is null or region = $region', params: ['region'], refs: [], start: 0, end: 0 },
    { name: 'share', sql: 'select revenue / 10 as share from sales', params: [], refs: ['sales'], start: 0, end: 0 },
  ],
};

const t = (revenue: number) => ({ rows: [{ revenue }], columns: [{ name: 'revenue', type: 'number' as const }] });

export function artifactFile(overrides: Partial<ArtifactFile> = {}): ArtifactFile {
  return {
    format: ARTIFACT_FILE_FORMAT,
    origin: 'https://app.artifactbin.dev',
    artifactId: 'Ab12Cd',
    liveUrl: 'https://app.artifactbin.dev/a/Ab12Cd',
    downloadedBy: 'Asha',
    downloadedAt: '2026-09-26T10:00:00.000Z',
    base: { version: 3, editId: 'e3', source: '<p id="a1">Hi</p>' },
    source: '<p id="a1">Hi</p>',
    metadata: { title: 'Sales </script><script>alert(1)</script>', description: null, theme: null, template: 'dashboard', colorMode: null },
    css: { base: 'body{margin:0}', compiled: '.p-7{padding:1.75rem}', author: null },
    island: { nodes: [], refData: {}, colorMode: 'light' } as unknown as ArtifactFile['island'],
    snapshot: {
      at: '2026-09-26T10:00:00.000Z',
      state: {
        values: { region: null },
        tables: { regions: { rows: [{ region: 'west' }, { region: 'east' }], columns: [{ name: 'region', type: 'string' }] }, sales: t(300), share: t(30) },
        errors: {},
      },
      variants: [
        { values: { region: 'west' }, tables: { sales: t(100), share: t(10) }, errors: {} },
        { values: { region: 'east' }, tables: { sales: t(200), share: t(20) }, errors: {} },
      ],
      frozen: [],
    },
    journal: [],
    threads: [],
    localIds: [],
    bundle: 'core',
    ...overrides,
  };
}
