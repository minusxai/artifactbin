/** One formatter for the hosted shell and unframed first-party UI. No selectors or document styles. */
const DOCUMENT_UI_FONT_FAMILIES = ['JetBrains Mono Variable', 'IBM Plex Sans'];
export function appFontFaceCss(faces) {
  return faces.map(f => `@font-face{font-family:'${f.family}';font-style:${f.style};font-display:${f.display};font-weight:${f.weight};`
    + `src:url(${f.url}) format('${f.format}');${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}}`).join('\n');
}
export function documentUiFontCss(faces) {
  return appFontFaceCss(faces.filter(face => DOCUMENT_UI_FONT_FAMILIES.includes(face.family)));
}
