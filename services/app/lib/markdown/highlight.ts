/**
 * THE EDITOR'S CODE HIGHLIGHTER WIRING: importing this (the editor entry does) lets editors load Prism and its grammars
 * (./code-block.ts) as a lazy chunk on their first code block with a language. Kept apart from ./extensions.ts so the
 * schema and the serializer (./save.ts) reach no Prism, and no timer or worker it starts.
 */
import { highlightLoader } from './extensions';

highlightLoader.load = () => import('./code-block');
