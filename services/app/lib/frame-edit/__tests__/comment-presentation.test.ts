/**
 * The inert comment chrome both readers share (comment-presentation, comment-actions-presentation): data the frame
 * bootstrap serializes, so it must stay plain JSON, and its paint must never hide or replace authored content.
 */
import { describe, expect, it } from 'vitest';
import { COMMENT_PRESENTATION } from '../comment-presentation';
import { COMMENT_ACTIONS_CSS } from '../comment-actions-presentation';
import { SELECTION_PRESENTATION } from '@/lib/editor-engine/selection-presentation';

describe('comment presentation', () => {
  it('is plain serializable data', () => {
    expect(JSON.parse(JSON.stringify(COMMENT_PRESENTATION))).toEqual(COMMENT_PRESENTATION);
  });

  it('carries the selection actions sheet and the comment selection colour', () => {
    expect(COMMENT_PRESENTATION.actionsCss).toBe(COMMENT_ACTIONS_CSS);
    expect(COMMENT_PRESENTATION.blockStyle.activeCss).toBe(SELECTION_PRESENTATION.selectedCss);
    expect(COMMENT_PRESENTATION.annotationCss).toContain(`[data-mx-annotate-selected] { ${SELECTION_PRESENTATION.selectedCss} }`);
  });

  it('hides every piece of comment chrome from a screenshot', () => {
    for (const selector of ['[data-mx-selection-actions]', '[data-mx-annotate-band]', '[data-mx-annotation-area]']) {
      expect(COMMENT_PRESENTATION.annotationCss).toContain(`.mx-taking-screenshot ${selector}`);
    }
  });

  it('paints no authored background: outlines and insets only', () => {
    expect(COMMENT_PRESENTATION.annotationCss).not.toMatch(/(^|[;{\s])background(-color)?\s*:/);
  });

  it('has an icon path list for each selection action', () => {
    for (const action of ['select', 'edit', 'annotate'] as const) {
      expect(COMMENT_PRESENTATION.icons[action].length).toBeGreaterThan(0);
      expect(COMMENT_PRESENTATION.icons[action].every((d) => typeof d === 'string' && /^[Mm]/.test(d))).toBe(true);
    }
  });
});

describe('comment actions sheet', () => {
  it('is scoped to the actions host, isolated from author CSS and topmost', () => {
    expect(COMMENT_ACTIONS_CSS).toContain('[data-mx-selection-actions]');
    expect(COMMENT_ACTIONS_CSS).toMatch(/all: initial/);
    expect(COMMENT_ACTIONS_CSS).toMatch(/z-index: 2147483646/);
    const open = (COMMENT_ACTIONS_CSS.match(/\{/g) ?? []).length;
    expect((COMMENT_ACTIONS_CSS.match(/\}/g) ?? []).length).toBe(open);
  });
});
