import type { AppFontFace } from './app-fonts';
export const DOCUMENT_UI_FONT_FAMILIES: readonly string[];
export function appFontFaceCss(faces: readonly AppFontFace[]): string;
export function documentUiFontCss(faces: readonly AppFontFace[]): string;
