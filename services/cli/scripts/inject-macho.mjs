/** Intel Mac's old postject writer corrupts TLS; use a hash-pinned modern writer at build time. */
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
export function injectMacho(binary,blob){
 const environment=resolve('node_modules/.cache/cli-lief'),python=join(environment,'bin/python3');
 if(!existsSync(python))execFileSync('python3',['-m','venv',environment],{stdio:'inherit'});
 execFileSync(python,['-m','pip','install','--disable-pip-version-check','--no-input','--only-binary=:all:','--require-hashes','-r',fileURLToPath(new URL('./sea-inject-requirements.txt',import.meta.url))],{stdio:'inherit'});
 execFileSync(python,[fileURLToPath(new URL('./sea-inject-macho.py',import.meta.url)),binary,blob],{stdio:'inherit'});
}
