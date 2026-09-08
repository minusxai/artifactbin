import {getStoryFontCss,storyFontFaceCss} from '@/lib/data/story/story-fonts';
import {STORY_COLUMN_CSS,STORY_DOCUMENT_CHROME_CSS,STORY_EMBED_CSS,STORY_TABLE_CSS} from '@/lib/story-runtime/chrome-css';
import {STORY_BARE_TYPOGRAPHY_CSS} from '@/lib/story-surface/bare-typography';
import {documentFontCss,documentFonts} from '@/lib/story/document-fonts';
import type {HelmetContent} from '@/lib/story/helmet';
import type {WebFontAsset} from '@/lib/webfonts';
import type {StoryThemeName} from '@/lib/validation/atlas-schemas';

/** Presentation rules shared by standalone/raw HTML and the direct SPA mount. */
export function storyPresentationCss(theme:StoryThemeName|null,helmet:HelmetContent,faces:WebFontAsset[]=[]):string {
  const fonts=documentFonts(helmet);
  return [
    ':root { --mx-vh: 100vh; }',
    STORY_BARE_TYPOGRAPHY_CSS,STORY_EMBED_CSS,STORY_TABLE_CSS,STORY_COLUMN_CSS,STORY_DOCUMENT_CHROME_CSS,
    getStoryFontCss(theme??undefined),
    faces.length?storyFontFaceCss(faces):'',
    documentFontCss(fonts),
  ].filter(Boolean).join('\n');
}
