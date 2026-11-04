/** A doc is named by its first heading on each region save, while its name still follows it (lib/artifacts doc-title). */
import { describe, expect, it } from 'vitest';
import { docTitleAfterSave } from '../doc-title';

const page = (title: string, heading: string) => `<!doctype html><html><head><title>${title}</title></head><body><main><article data-af-editable="rich"><h1>${heading}</h1><p></p></article></main></body></html>`;
const doc = (title: string, heading: string, template: string | null = 'doc') => ({ meta: template ? { template } : {}, title, source: page(title, heading) });

describe('docTitleAfterSave', () => {
  it('names an untitled doc by the heading first typed into it', () => {
    expect(docTitleAfterSave(doc('Untitled document', ''), page('Untitled document', 'Q3 plan'))).toEqual({ html: page('Q3 plan', 'Q3 plan'), title: 'Q3 plan' });
  });
  it('follows a heading it still names', () => {
    expect(docTitleAfterSave(doc('Q3 plan', 'Q3 plan'), page('Q3 plan', 'Q3 plan v2'))?.title).toBe('Q3 plan v2');
  });
  it('leaves a renamed doc, an unchanged or emptied heading, and a page that is not a doc alone', () => {
    expect(docTitleAfterSave(doc('Board memo', 'Q3 plan'), page('Q3 plan', 'Q3 plan v2'))).toBeNull();
    expect(docTitleAfterSave(doc('Q3 plan', 'Q3 plan'), page('Q3 plan', 'Q3 plan'))).toBeNull();
    expect(docTitleAfterSave(doc('Q3 plan', 'Q3 plan'), page('Q3 plan', ''))).toBeNull();
    expect(docTitleAfterSave(doc('Notes', 'Notes', null), page('Notes', 'Notes v2'))).toBeNull();
  });
  it('picks the heading up again once an emptied heading is typed into', () => {
    expect(docTitleAfterSave(doc('Q3 plan', ''), page('Q3 plan', 'Roadmap'))?.title).toBe('Roadmap');
  });
});
