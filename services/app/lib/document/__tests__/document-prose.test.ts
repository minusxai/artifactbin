import {expect,it} from 'vitest';
import {inertProse} from '../document-prose';
it.each(['className="x"','<style>x</style>','{$_row.name}','\0','\ud800','\r\n','/people/person'])('contextual tokens are not independent prose: %s',value=>expect(inertProse(value)).toBe(false));
