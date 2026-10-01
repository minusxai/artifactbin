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
