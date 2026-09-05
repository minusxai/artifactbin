import { describe, expect, it } from 'vitest';

import { artifactSummaryToWire } from '@/lib/artifact-wire';

const summary = (format: 'markup' | 'dataset' | 'viz' | 'image', meta: Record<string, unknown>) => ({
  id: 'Ab3xK9',
  token_id: 'secret-token-id',
  user_id: 'secret-user-id',
  actor_user_id: 'secret-author-id',
  actor_token_id: 'secret-author-token',
  title: 'Quarterly report',
  description: 'A concise summary',
  format,
  content: 'FULL CONTENT MUST NEVER BE LISTED',
  source: '<main>FULL MARKUP MUST NEVER BE LISTED</main>',
  edit_id: 'secret-edit-id',
  version: 3,
  visibility: 'private' as const,
  access: 'read' as const,
  ancestor_ids: ['f00001'],
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-30T00:00:00.000Z',
  views: 12,
  meta,
});

describe('artifactSummaryToWire', () => {
  it('projects an explicit list item and never leaks artifact content or credentials', () => {
    const wire = artifactSummaryToWire(
      summary('markup', {
        theme: 'industry',
        template: 'deck',
        colorMode: 'dark',
        refs: [{ id: 'data1', kind: 'dataset' }],
        compiledCss: '.entire-document { color: red }',
        cssCompileVersion: 'secret-build-detail',
      }),
      'https://artifact.test',
    );

    expect(wire).toMatchObject({
      id: 'Ab3xK9',
      url: 'https://artifact.test/a/Ab3xK9',
      title: 'Quarterly report',
      format: 'markup',
      version: 3,
      views: 12,
      meta: {
        theme: 'industry',
        template: 'deck',
        colorMode: 'dark',
        refs: [{ id: 'data1', kind: 'dataset' }],
      },
    });
    for (const forbidden of [
      'content',
      'source',
      'markup',
      'edit_id',
      'token_id',
      'user_id',
      'actor_user_id',
      'actor_token_id',
    ]) {
      expect(wire).not.toHaveProperty(forbidden);
    }
    expect(wire.meta).not.toHaveProperty('compiledCss');
    expect(wire.meta).not.toHaveProperty('cssCompileVersion');
  });

  it.each([
    [
      'dataset' as const,
      { columns: [{ name: 'month', type: 'text' }], rowCount: 10, objectKey: 'private/data.csv' },
      { columns: [{ name: 'month', type: 'text' }], rowCount: 10 },
    ],
    [
      'viz' as const,
      { slots: [{ name: 'data', accepts: ['dataset'] }], recipeSource: 'full recipe' },
      { slots: [{ name: 'data', accepts: ['dataset'] }] },
    ],
    [
      'image' as const,
      { contentType: 'image/webp', bytes: 1234, width: 200, height: 100, objectKey: 'private/image.webp', placeholder: 'data:image/webp;base64,full-preview' },
      { contentType: 'image/webp', bytes: 1234, width: 200, height: 100 },
    ],
  ])('keeps only safe %s list metadata', (format, meta, expected) => {
    expect(artifactSummaryToWire(summary(format, meta), 'https://artifact.test').meta).toEqual(expected);
  });
});

describe('placement on the wire (P1, seeded)', () => {
  it('carries parent_id and ancestor_ids, never folder', () => {
    const base = { id: 'Ab3xK9', title: 't', description: null, format: 'markup', version: 1, visibility: 'private', meta: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as never;
    const filed = artifactSummaryToWire({ ...(base as object), ancestor_ids: ['f00001', 'f00002'] } as never, 'https://x');
    expect(filed).toMatchObject({ parent_id: 'f00002', ancestor_ids: ['f00001', 'f00002'] });
    expect(filed).not.toHaveProperty('folder');
    const root = artifactSummaryToWire({ ...(base as object), ancestor_ids: [] } as never, 'https://x');
    expect(root).toMatchObject({ parent_id: null, ancestor_ids: [] });
  });
});
