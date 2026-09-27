/**
 * The app shell's own faces — the @font-face rules its stylesheet carries and
 * the one its first screen paints.
 *
 * GENERATED with the story fonts (scripts/copy-assets.mjs): every face the
 * shell's @fontsource packages declare, served from the same content-addressed
 * /fonts files the story names, so a document read inside the app never
 * fetches a face twice. vite.config.mts writes these rules into the shell's
 * stylesheet at build time; the server preloads APP_SHELL_FONT_PRELOADS on the
 * pages whose first screen is the shell's (server/app).
 */
import fontManifest from '@/lib/data/story/story-font-manifest.json';

export interface AppFontFace {
  family: string;
  url: string;
  style: string;
  weight: string;
  display: string;
  format: string;
  unicodeRange?: string;
}

export const APP_FONT_FACES: readonly AppFontFace[] = fontManifest.app as AppFontFace[];

/** The family every shell page sets its text in (app/globals.css `--font-jb-mono`, the body's `--font-mono`). */
const SHELL_TEXT_FAMILY = 'JetBrains Mono Variable';
/** The latin subset's range starts at U+0000; the other subsets are unicode-range lazy. */
const isLatin = (face: AppFontFace) => /^U\+0+(?:-|,|$)/i.test(face.unicodeRange ?? '');

/**
 * What a shell page's first screen paints, measured (home, login, docs, a
 * profile, a 404): the upright latin of the shell's mono, at every weight —
 * one variable file. Other shell faces (IBM Plex Sans, Cormorant) appear only
 * on some pages and are left to discovery rather than preloaded where unused.
 */
export const APP_SHELL_FONT_PRELOADS: readonly string[] = APP_FONT_FACES
  .filter((face) => face.family === SHELL_TEXT_FAMILY && face.style === 'normal' && isLatin(face))
  .map((face) => face.url);
