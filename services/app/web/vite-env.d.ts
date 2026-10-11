/**
 * The one Vite build flag the app reads: `import.meta.env.DEV` is true under the dev server and folded to the
 * literal `false` by a production build, so code behind it (solid/App.tsx's `/dev/ui` gallery) drops out.
 */
export {};
declare global {
  interface ImportMetaEnv { readonly DEV: boolean }
  interface ImportMeta { readonly env: ImportMetaEnv }
}
