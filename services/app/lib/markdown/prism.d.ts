declare module 'prismjs/components/prism-core' {
  type Token = { type: string; content: string | Token | Token[]; alias?: string | string[] };
  const Prism: {
    languages: Record<string, unknown>;
    tokenize(source: string, grammar: Record<string, unknown>): (string | Token)[];
  };
  export default Prism;
}

declare module 'prismjs/components/prism-markup';
declare module 'prismjs/components/prism-clike';
declare module 'prismjs/components/prism-css';
declare module 'prismjs/components/prism-javascript';
declare module 'prismjs/components/prism-typescript';
declare module 'prismjs/components/prism-jsx';
declare module 'prismjs/components/prism-tsx';
declare module 'prismjs/components/prism-markdown';
