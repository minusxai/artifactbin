/**
 * THE ENTRY IS TWO IMPORTS, AND THEIR ORDER IS THE POINT. ESM evaluates
 * dependencies depth-first in declaration order, so preload.cjs (the cwd
 * contract + the yaml hook) completes before main's entire subtree loads —
 * which a `-r` flag also promised, until a node minor changed how relative
 * `--require` paths resolve on CI. Two static imports cannot drift.
 */
import './preload.cjs';
import './main';
