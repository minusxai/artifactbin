import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';import sql from 'highlight.js/lib/languages/sql';
for (const [n,l] of Object.entries({xml,css,javascript,typescript,json,bash,python,sql})) hljs.registerLanguage(n,l);
hljs.registerAliases(['html','svg'],{languageName:'xml'});hljs.registerAliases(['js','jsx','mjs'],{languageName:'javascript'});
hljs.registerAliases(['ts','tsx'],{languageName:'typescript'});hljs.registerAliases(['sh','shell','zsh'],{languageName:'bash'});hljs.registerAliases(['py'],{languageName:'python'});
hljs.configure({classPrefix:'tok-', ignoreUnescapedHTML:true});
export function highlightAll(root=document){for(const c of root.querySelectorAll('pre > code[class*="language-"]')){const m=/(?:^|\s)language-(\S+)/.exec(c.className);if(m&&hljs.getLanguage(m[1]))hljs.highlightElement(c)}}
export {hljs};
