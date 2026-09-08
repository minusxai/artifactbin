import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

/** Browser-safe prepared artifact. Script bytes are inert data, executed only by the sandbox runtime. */
export interface PreparedStoryRuntime {
  data: StoryIslandData;
  baseCss: string;
  compiledCss: string | null;
  authorCss: string | null;
  authorScript: string | null;
  theme: StoryThemeName | null;
  title: string;
}
