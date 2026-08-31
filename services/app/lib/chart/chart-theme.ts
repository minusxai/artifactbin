
/**
 * MinusX BI chart theme constants — palettes, fonts, light/dark tokens. Engine-free
 * (deleted ECharts): consumed by the Vega theme (lib/viz/theme.ts) and the
 * story CSS builder (lib/data/story/story-css.server.ts).
 */

// Reads the CSS variable so charts honor the same font override as the rest of the app
export function getChartFontFamily(): string {
  const fallback = 'JetBrains Mono, Consolas, Monaco, Courier New, monospace'
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--font-jetbrains-mono')
    .trim() || fallback
}

// Flat UI Colors from theme.ts + extended palette for many-series charts
export const CHART_COLORS = {
  primary: '#2980b9',      // Belize Hole (blue)
  danger: '#c0392b',       // Pomegranate (red)
  teal: '#16a085',         // Green Sea (teal)
  purple: '#9b59b6',       // Amethyst (purple)
  success: '#2ecc71',      // Emerald (green)
  warning: '#f39c12',      // Orange
  // Additional colors for multi-series
  turquoise: '#1abc9c',    // Turquoise
  nephritis: '#27ae60',    // Nephritis (dark green)
  peterRiver: '#3498db',   // Peter River (light blue)
  wisteria: '#8e44ad',     // Wisteria (dark purple)
  sunflower: '#f1c40f',    // Sun Flower (yellow)
  carrot: '#e67e22',       // Carrot (dark orange)
  silver: '#bdc3c7',       // Silver (light gray)
  moonlight: '#34495e',    // Midnight Blue (dark gray)
  // Extended palette for many-series charts (all flat/saturated)
  coral: '#e74c3c',        // Alizarin (coral red)
  rose: '#d63384',         // Rose pink
  indigo: '#5b4cc4',       // Indigo
  cyan: '#0097a7',         // Cyan
  olive: '#7cb342',        // Olive green
  magenta: '#c2185b',      // Magenta
  brown: '#8d6e63',        // Brown
  slate: '#546e7a',        // Slate blue-gray
  ocean: '#0984e3',        // Ocean blue
  forest: '#00897b',       // Forest green
  wine: '#880e4f',         // Wine
  steel: '#455a64',        // Steel
}

// Color palette for multi-series charts (24 visually distinct colors)
// First 8 preserve original order; extended colors alternate hues for contrast
export const COLOR_PALETTE = [
  CHART_COLORS.teal,        // 1. Teal (original)
  CHART_COLORS.primary,     // 2. Blue (original)
  CHART_COLORS.danger,      // 3. Red (original)
  CHART_COLORS.sunflower,   // 4. Yellow (original)
  CHART_COLORS.purple,      // 5. Purple (original)
  CHART_COLORS.carrot,      // 6. Dark orange (original)
  CHART_COLORS.silver,      // 7. Silver (original)
  CHART_COLORS.moonlight,   // 8. Midnight blue (original)
  CHART_COLORS.rose,        // 9. Rose pink
  CHART_COLORS.forest,      // 10. Forest green
  CHART_COLORS.ocean,       // 11. Ocean blue
  CHART_COLORS.olive,       // 12. Olive green
  CHART_COLORS.magenta,     // 13. Magenta
  CHART_COLORS.cyan,        // 14. Cyan
  CHART_COLORS.indigo,      // 15. Indigo
  CHART_COLORS.brown,       // 16. Brown
  CHART_COLORS.coral,       // 17. Coral red
  CHART_COLORS.nephritis,   // 18. Dark green
  CHART_COLORS.wine,        // 19. Wine
  CHART_COLORS.peterRiver,  // 20. Light blue
  CHART_COLORS.slate,       // 21. Slate
  CHART_COLORS.success,     // 22. Emerald
  CHART_COLORS.wisteria,    // 23. Dark purple
  CHART_COLORS.steel,       // 24. Steel
]

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// Light mode colors (matching theme.ts)
export const LIGHT_THEME = {
  bgCanvas: '#FAFBFC',
  bgSurface: '#FFFFFF',
  bgMuted: '#F6F8FA',
  fgDefault: '#0D1117',
  fgMuted: '#57606A',
  fgSubtle: '#8B949E',
  borderDefault: '#D0D7DE',
  borderMuted: '#E5E9ED',
}

// Dark mode colors (matching theme.ts)
export const DARK_THEME = {
  bgCanvas: '#0D1117',
  bgSurface: '#161B22',
  bgMuted: '#010409',
  fgDefault: '#E6EDF3',
  fgMuted: '#8B949E',
  fgSubtle: '#6E7681',
  borderDefault: '#30363D',
  borderMuted: '#21262D',
}

