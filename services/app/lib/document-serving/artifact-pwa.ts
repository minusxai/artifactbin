/** Stable app identity and scope. Never include viewer credentials or revision state. */
export const artifactAppPath = (id: string): string => `/a/${encodeURIComponent(id)}/app/`;

export interface ArtifactManifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: 'image/png'; purpose: 'any maskable' }>;
}
