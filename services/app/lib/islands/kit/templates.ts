/**
 * TEMPLATES IN STRINGS, AT RUN TIME (`@mx/kit/templates`): the calls the compiler emits for a string that reads the page
 * (lib/jsx/template, compiler `TEMPLATE_CALLS`). The same pure resolver runs in the SSR render and the browser, over
 * the island's values and first-row cells (rt `signalsOf`), so the served markup and the hydrated page agree. Its
 * own chunk: a page without a template never downloads it.
 */
import { holeReader, parseTemplate, resolveTemplate, STYLE_ATTR_KEY, substituteViz } from '@/lib/jsx/template';
import { resolveAttributes } from '@/lib/jsx/template-attrs';
import { useIsland } from '../context';
import type { IslandContext } from '../contract';
import { signalsOf } from '../rt';
import { noteClasses } from '../runtime-css';

/** A templated string prop or class, filled from the page (values, first-row cells) and `row`. */
export const tplText = (value: string, row?: Record<string, unknown>, island: IslandContext = useIsland()): string => {
  const parts = parseTemplate(value);
  return parts ? resolveTemplate(parts, holeReader(signalsOf(island), row)) : value;
};

/**
 * What a template filled into a class is noted (../runtime-css): one the document's sheet lacks is hidden until the sheet
 * has it. Only the filled tokens: the written ones (a kit recipe merged in at compile time) are the sheet's already.
 */
const noteFilled = (template: string | undefined, out: string | undefined): void => {
  if (!template || !out) return;
  const written = new Set(template.split(/\s+/));
  noteClasses(out.split(/\s+/).filter((token) => !written.has(token)).join(' '));
};

/** A templated class, filled like any string prop, its filled classes noted. */
export const tplClass = (value: string, row?: Record<string, unknown>, island: IslandContext = useIsland()): string => {
  const out = tplText(value, row, island);
  noteFilled(value, out);
  return out;
};

/**
 * An element's templated attributes, resolved and guarded (`resolveAttributes`): a dangerous URL or a hole without a
 * value drops the attribute, an unsafe `style` value is left out. `style` is spread as an attribute, never through the
 * CSSOM, so hydration keeps the served bytes.
 */
export const tplAttrs = (attrs: Readonly<Record<string, string>>, row?: Record<string, unknown>, island: IslandContext = useIsland()): Record<string, string> => {
  const out = resolveAttributes(attrs, holeReader(signalsOf(island), row));
  noteFilled(attrs.class ?? attrs.className, out.class ?? out.className);
  if (Object.hasOwn(out, 'style')) { out[STYLE_ATTR_KEY] = out.style!; delete out.style; }
  return out;
};

/** A chart's templated spec (or a table's column specs), filled (lib/jsx/template `substituteViz`). */
export const tplViz = <T,>(value: T, row?: Record<string, unknown>, island: IslandContext = useIsland()): T => substituteViz(value, holeReader(signalsOf(island), row));
