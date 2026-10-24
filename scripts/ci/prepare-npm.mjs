/** Prepare the exact audited npm toolchain in the active CI Node installation. */
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {npmDriver} from './npm-driver.mjs';
const prefix=process.platform==='win32'?dirname(process.execPath):resolve(dirname(process.execPath),'..');
execFileSync(process.execPath,[npmDriver(),'install','--global','--prefix',prefix,'--no-audit','--no-fund','npm@11.19.1'],{stdio:'inherit'});
await import('../../deploy/company/patch-npm.mjs');
