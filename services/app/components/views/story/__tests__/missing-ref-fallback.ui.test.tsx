/**
 * Missing-data runtime degradation: a table the store does not hold (its
 * query failed, or a recipe ref whose target was deleted AFTER publish) must
 * degrade to each embed's graceful fallback — never a crash, never a blank
 * page. (Publish-time validation is jsx-tier.test.ts; this pins the VIEW-time
 * contract.)
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionEmbed from '@/components/views/story/QuestionEmbed';
import InlineNumber from '@/components/views/story/InlineNumber';

const ROWS = { rows: [{ region: 'EU', revenue: 1 }], columns: [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }] };

describe('missing-ref runtime degradation', () => {
  it('QuestionEmbed bound to a table the store does not have renders the empty fallback', () => {
    renderWithProviders(<QuestionEmbed data="$gone" viz={undefined} tables={{}} colorMode="light" />);
    expect(screen.getByText(/data unavailable/i)).toBeTruthy();
  });

  it('QuestionEmbed with rows but an unresolved recipe ref renders the recipe fallback', () => {
    renderWithProviders(
      <QuestionEmbed
        data="$sales"
        viz={{ kind: 'recipe', recipe: 'ref:gonerc' }}
        tables={{ sales: ROWS }}
        refData={{}}
        colorMode="light"
      />,
    );
    expect(screen.getByText(/recipe unavailable/i)).toBeTruthy();
  });

  it('InlineNumber with a format spec d3 cannot parse renders the number anyway — never throws (a document published before the door checked it)', () => {
    renderWithProviders(<InlineNumber data="$sales" col="revenue" agg="sum" format=",0" tables={{ sales: ROWS }} />);
    expect(screen.getByLabelText('Live number').textContent).toBe('1');
  });

  it('InlineNumber bound to a missing table renders the placeholder, not NaN', () => {
    renderWithProviders(<InlineNumber data="$gone" col="revenue" agg="sum" tables={{}} />);
    const el = screen.getByLabelText('Number placeholder');
    expect(el.textContent).toBe('—');
  });
});
