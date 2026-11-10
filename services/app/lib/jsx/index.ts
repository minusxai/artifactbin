/**
 * Static data parsing retained by the dataset definition codec. It parses static JSX dataset definitions only:
 * preserve literal attribute parsing, source spans and the rejection of executable expressions. It never compiles
 * or executes published documents; hosted HTML component specifications belong to lib/html-component-specs.
 */
export * from './types';
export {parseJsx} from './parse';
