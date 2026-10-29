/** One formatter for the hosted shell and unframed first-party UI. No selectors or document styles. */
export function appFontFaceCss(faces) {
  return faces.map(f => `@font-face{font-family:'${f.family}';font-style:${f.style};font-display:${f.display};font-weight:${f.weight};`
    + `src:url(${f.url}) format('${f.format}');${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}}`).join('\n');
}
