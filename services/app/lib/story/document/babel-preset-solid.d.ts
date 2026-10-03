/** babel-preset-solid ships no types: the preset function Babel takes (author-module.server, the island build's transform). */
declare module 'babel-preset-solid' {
  import type { ConfigAPI, TransformOptions } from '@babel/core';
  const preset: (api: ConfigAPI, options?: { generate?: 'dom' | 'ssr' | 'universal'; hydratable?: boolean; moduleName?: string; delegateEvents?: boolean }) => TransformOptions;
  export default preset;
}
