/**
 * The `<DeckGL>` map's chrome — its classes and attribution line — shared by today's engine
 * (components/kit/deck-gl-engine), the compiled page's island shell and engine (lib/islands/kit/embed).
 * A leaf module: the island shell reads the figure class without loading deck.gl. Its class literals
 * are a story class source (scripts/generate-story-ui-classes EXTRA_CLASS_SOURCES).
 */
/** The map's chrome classes, shared by both views (Tailwind candidates stay in one place). */
export const MAP_CLASSES = {
  /** The box before the engine lands (components/kit/deck-gl's stand-in), then the map's figure. */
  loading: 'w-full rounded-md bg-muted',
  figure: 'relative w-full overflow-hidden rounded-md',
  controls: 'absolute right-2 top-2 flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border shadow-sm',
  button: 'flex h-7 w-7 cursor-pointer items-center justify-center border-0 bg-background p-0 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
  legend: 'absolute bottom-5 left-2 flex max-w-[45%] flex-col gap-2 rounded-md border border-border bg-background/90 px-2 py-1.5 text-[11px] leading-tight text-foreground shadow-sm',
  legendEntry: 'flex flex-col gap-1',
  legendLabel: 'font-medium text-muted-foreground',
  ramp: 'flex items-center gap-1.5',
  rampBar: 'h-2 w-24 rounded-sm',
  swatches: 'm-0 flex list-none flex-wrap gap-x-2 gap-y-0.5 p-0',
  swatch: 'flex items-center gap-1',
  dot: 'h-2 w-2 shrink-0 rounded-full',
  swatchLabel: 'truncate',
  attribution: 'pointer-events-none absolute bottom-1 right-2 m-0 text-[10px] leading-none text-muted-foreground',
} as const;
export const ATTRIBUTION = '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
