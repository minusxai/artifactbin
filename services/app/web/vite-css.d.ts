declare module '*.css?inline' {
  const css: string;
  export default css;
}
declare module '*.css?url' {
  const url: string;
  export default url;
}
// A bare stylesheet import (`import 'x.css'`) is bundled for its side effect and exports nothing.
declare module '*.css' {}
// First-party branding is served by Vite and embedded as a data URL in portable bundles.
declare module '*.png' {
  const url: string;
  export default url;
}
