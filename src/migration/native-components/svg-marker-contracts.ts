/** Source-authored inert reveal marker on an SVG root; no inferred default. */
export interface NativeSvgRevealMarker { 'data-reveal'?: boolean }
export const isNativeSvgRevealMarker=(value:unknown):value is NonNullable<NativeSvgRevealMarker['data-reveal']>=>typeof value==='boolean';
