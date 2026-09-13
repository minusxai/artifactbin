import {provisionRuntime} from './runtime.mjs';
console.log(`Verified prebuilt CLI runtime: ${await provisionRuntime()}`);
