/** Only compiler-produced first-party CSS may enter here, never author CSS.
 * Root selectors must match our inner scope, not the host: custom properties
 * are reset on that scope so document inheritance cannot supply UI tokens. */
export function scopeTrustedStyles(css: string): string {
  const scope = '[data-trusted-ui-root]';
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[^{}]+(?=\{)/g, selector => {
    return selector.replace(/(^|[\s,>+~(])(?::root\b|:host\b|html\b|body\b)/g, (_match, prefix: string) => prefix + scope);
  }) + `\n${scope}{background:none;min-height:0;}`;
}
