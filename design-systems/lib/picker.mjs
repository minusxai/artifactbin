/** The editor's live miniature gallery, from the same covers as the published catalogue. */
import { ROSTER, loadSpec } from './pages.mjs';

// Keep SVG paint/type only. A cover class can also name an HTML component (so-grid, for example);
// its layout rules must never turn an SVG group into a grid or escape into the editor.
const PAINT = /^(?:fill|stroke(?:-[a-z-]+)?|font-(?:family|size|stretch|style|weight)|letter-spacing|mix-blend-mode|opacity|stop-(?:color|opacity))$/;

export function pickerSpecimen(spec) {
  const classes = new Set([...spec.cover_svg.matchAll(/className="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  const scope = `[data-design-specimen="${spec.slug}"]`;
  const rules = [`${scope} { --font-sans: var(--font-body); }`];
  // Spec rules have flat declarations. Container/media wrappers cannot add paint properties here.
  for (const [, selector, body] of spec.css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // The drawing vocabulary aliases its inks at the system root, outside the public token map.
    // Keep those aliases as well as the SVG rules, otherwise var(--ds-hand-fill) paints black.
    if (selector.trim() === `.ds-${spec.slug}`) {
      const variables = body.split(';').map(s => s.trim()).filter(s => /^--ds-[\w-]+\s*:/.test(s));
      if (variables.length) rules.push(`${scope} { ${variables.join('; ')}; }`);
      continue;
    }
    const selectors = selector.trim().split(',').map(s => s.trim()).filter(s =>
      s.startsWith(`.ds-${spec.slug} `) && [...s.matchAll(/\.([\w-]+)/g)].slice(1).every(m => classes.has(m[1])));
    const declarations = body.split(';').map(s => s.trim()).filter(s => PAINT.test(s.split(':')[0].trim()));
    if (selectors.length && declarations.length) rules.push(`${selectors.join(', ').replaceAll(`.ds-${spec.slug}`, scope)} { ${declarations.join('; ')}; }`);
  }
  // These are repository-owned, static SVG specimens, never artifact/user markup. Convert JSX attribute
  // spelling once at generation, leaving the browser no parser/compiler or document CSS to load.
  const svg = spec.cover_svg.replace(/className=/g, 'class=').replace(/textAnchor=/g, 'text-anchor=')
    .replace(/clipPath=/g, 'clip-path=').replace(/strokeWidth=/g, 'stroke-width=').replace(/shapeRendering=/g, 'shape-rendering=');
  return { name: spec.slug, mood: spec.mood, svg, css: rules.join('\n') };
}

export function renderPicker() {
  const specimens = ROSTER.map(slug => pickerSpecimen(loadSpec(slug)));
  return {
    data: JSON.stringify(specimens.map(({ css, ...specimen }) => { void css; return specimen; }), null, 1) + '\n',
    css: specimens.map(s => s.css).join('\n') + '\n',
  };
}
