/**
 * The shared structural safety grammar for markup documents.
 *
 * Publish-time diagnostics and read-time refusal must agree on what can become
 * reader DOM. Keeping the exact Helmet grammar, component registry, HTML tag
 * vocabulary and inline-style policy here prevents stored historical rows from
 * finding a weaker second door at render time.
 */
import { validateJsx, type JsxNode, type ValidationError } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { splitHelmet, validateHelmet, type HelmetSplit } from './helmet';

export interface StoryStructureValidation {
  split: HelmetSplit;
  helmetErrors: ValidationError[];
  bodyErrors: ValidationError[];
}

export function validateStoryStructure(nodes: JsxNode[]): StoryStructureValidation {
  const split = splitHelmet(nodes);
  return {
    split,
    helmetErrors: validateHelmet(nodes),
    bodyErrors: validateJsx(split.body, {
      components: JSX_STORY_COMPONENT_NAMES,
      allowedHtmlTags: STORY_HTML_TAGS,
      stylePolicy: 'no-inline-style',
    }),
  };
}
