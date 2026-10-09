import type { StoryTemplateName } from '@/lib/validation/atlas-schemas';
import { EMPTY_ARTIFACT_MARKUP } from '@artifactbin/contracts';

/** The creation menu's vocabulary and initial content; every write uses the normal artifact API. */
export const ARTIFACT_STARTERS = [
  { template: 'doc', label: 'Blank document' },
  { template: 'editorial', label: 'Article' },
  { template: 'deck', label: 'Presentation' },
  { template: 'dashboard', label: 'Dashboard' },
  { template: 'plan', label: 'Plan' },
  { template: 'landing', label: 'Landing page' },
  { template: 'scrolly', label: 'Scrollytelling' },
  { template: 'app', label: 'App' },
] as const satisfies ReadonlyArray<{ template: StoryTemplateName; label: string }>;

const BLANK_DOCUMENT_MARKUP = '<article id="document" data-design="tw"><h1 id="headline" data-placeholder="Headline" className="min-h-12 text-4xl font-semibold tracking-tight"></h1><Markdown id="body" data-placeholder="Start writing…" className="mt-6 min-h-7 text-base leading-relaxed">{``}</Markdown></article>';

export function artifactStarter(template: StoryTemplateName, parentId?: string | null) {
  return { markup: template === 'doc' ? BLANK_DOCUMENT_MARKUP : EMPTY_ARTIFACT_MARKUP, template, title: null, visibility: 'private' as const, parent_id: parentId ?? null };
}
