import MarkdownIt from 'markdown-it';
const parser=new MarkdownIt('commonmark',{html:false,linkify:false,typographer:false});
// No image fetches in the minimal policy; retain meaningful alt content.
/** @param {import("markdown-it/lib/token.mjs").default[]} tokens @param {number} index */
const imageRule=(tokens,index)=>parser.utils.escapeHtml(tokens[index].content);
parser.renderer.rules.image=imageRule;
/** @type {import("./contracts.js").MarkdownRenderer["render"]} */
export function render(source){if(typeof source!=='string')throw new TypeError('Markdown source must be a string');return parser.render(source);}
/** @type {import("./contracts.js").MarkdownRenderer["encode"]} */
export function encode(source){if(typeof source!=='string')throw new TypeError('Markdown source must be a string');return JSON.stringify(source).replaceAll('<','\\u003c');}
/** @type {import("./contracts.js").MarkdownRenderer["decode"]} */
export function decode(json){const source=JSON.parse(json);if(typeof source!=='string')throw new TypeError('Markdown source must decode to a string');return source;}
