/**
 * The validation module's interface: the names a document's fence may carry (the six themes, the design systems, the
 * templates), each design system's colour mode, the installation design system's registry, and the shapes of a column
 * format and a workspace recipe's slots. Every file here is dependency-free, so browser, reader and skill bundles take
 * values from this index; explicit .ts specifiers let skill scripts load it under Node in a source checkout.
 */
import { STORY_THEME_NAMES, type StoryDesignName } from './story-theme-names.ts';
import { STORY_SYSTEM_NAMES } from './story-system-names.ts';

export { STORY_THEME_NAMES, STORY_SYSTEM_NAMES };
export type { StoryDesignName, StoryThemeName } from './story-theme-names.ts';
export type { StorySystemName } from './story-system-names.ts';
export { HTML_SYSTEM_MODES } from './html-system-modes.ts';
export {
  defaultHtmlSystemName, htmlSystemMode, installationDesignSystem, isKnownHtmlSystem, isLightOnlyHtmlSystem, setDefaultHtmlSystem,
  setInstallationDesignSystem, type InstallationDesignSystem,
} from './installation-design-system.ts';

/** Everything a fence `theme` may name: the six themes, then the design systems (lib/html-systems/story-systems). */
export const STORY_DESIGN_NAMES: readonly StoryDesignName[] = [...STORY_THEME_NAMES, ...STORY_SYSTEM_NAMES];

/**
 * The story templates — the document's PAGE TYPE (beat structure + layout
 * grammar, and the runtime behaviour that comes with it: the contents rail for
 * editorial and plan, present mode for a deck), orthogonal to the design.
 */
export const STORY_TEMPLATE_NAMES = ['doc', 'editorial', 'deck', 'scrolly', 'dashboard', 'plan', 'app', 'landing'] as const;

/** How one column of a result is shown. */
export interface ColumnFormatConfig {
  /** Display name override for the column header. */
  alias?: string | null;
  /**
   * d3 format string for numeric values — the VEGA-TIER vocabulary (recipe sources): e.g. ',.0f', '$,.2f', '.2~s'.
   * Takes precedence over decimalPoints/prefix/suffix. DOM grids (table/pivot) ignore it — they use the fields below.
   */
  format?: string | null;
  /** Number of decimal places (0-4) for numeric columns. */
  decimalPoints?: number | null;
  /**
   * Date display format as a Unicode date pattern, e.g. 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM dd, yyyy',
   * "MMM'yy", 'yyyy', 'yyyy-MM-dd HH:mm', 'HH:mm:ss'. Tokens: yyyy (4-digit year), yy (2-digit year), MMMM (full
   * month), MMM (short month), MM (month number), dd (day), HH (hours 24h), mm (minutes), ss (seconds).
   */
  dateFormat?: string | null;
  /** String to prepend to displayed values (e.g. '$', '€'). */
  prefix?: string | null;
  /** String to append to displayed values (e.g. '%', ' units', 'k'). */
  suffix?: string | null;
}

/*
 * A workspace `.viz` document: an INERT spec template with declared binding slots — data, never code. Identity is the
 * FILE NAME (no name field, no version suffix); a same-named file in a nearer folder shadows an ancestor's.
 */
/** One binding slot of a workspace recipe. */
export interface VizRecipeBinding {
  /** Slot name referenced by {{name}} tokens in the template. */
  name: string;
  /** Human label shown on the drop zone. */
  label: string;
  /** Column kinds this slot accepts (drives drop-zone hints and the {{name:kind}} fallback). */
  accepts: Array<'nominal' | 'quantitative' | 'temporal'>;
  /** Slot takes an ARRAY of columns (e.g. a fold field list); {{name}} must then be a whole-value token. */
  multi?: boolean;
}

/** One param of a workspace recipe. */
export interface VizRecipeParam {
  /** Param name referenced by {{name}} tokens in the template. */
  name: string;
  label: string;
  /** Value used when the param is omitted at use. */
  default?: unknown;
}
