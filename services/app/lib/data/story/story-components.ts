/**
 * The RETIRED legacy story design-system components — a name list, and nothing else.
 *
 * These were a compile-to-static-HTML component set with their own class recipes.
 * Nothing renders them and nothing can publish them: the current vocabulary is
 * `JSX_STORY_COMPONENT_NAMES` (the kit registry in lib/story-ui plus the data
 * embeds), and an author reaching for one of these names gets an unknown-component
 * error from the static validator like any other unregistered tag.
 *
 * The list survives for exactly one reason, and it is a good one: `lib/jsx/validate.ts`
 * checks unknown Capitalized tags against it so the error can say *"<Callout> is a
 * LEGACY story component that is no longer available — rebuild it with plain HTML tags
 * + Tailwind utilities, or use the registered components"* instead of a bare "unknown
 * component". The authors here are models, and that message is their only route to
 * self-correction — without it they retry the same dead tag.
 *
 * So: add a name here when you retire a component, and never add one for any other
 * reason. Anything richer (the old `tag`/`props`/`classes` recipes) was carried for
 * years after the codec that read them was gone.
 */

/** Legacy component names, kept so the validator can name the replacement. */
export const STORY_COMPONENT_NAMES = [
  'Section',
  'Eyebrow',
  'Grid',
  'Card',
  'Stat',
  'StatLabel',
  'StatValue',
  'StatDelta',
  'Pill',
  'Callout',
  'Quote',
  'Headline',
  'Standfirst',
  'PageHeader',
  'PageFooter',
  'Takeaways',
  'FigurePlate',
];
