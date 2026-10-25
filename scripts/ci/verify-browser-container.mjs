#!/usr/bin/env node
/** Bounded restore pre-start hook; never starts a container or accepts unknown ownership. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {verifyBrowserContainer} from '../lib/browser-container-policy.mjs';
const id=process.argv[2],owner=process.env.BROWSER__CONTAINER_OWNER,receiptFile=process.env.BROWSER__OWNER_RECEIPT,cpus=Number(process.env.BROWSER__CPU_CAP);
assert.ok(id&&owner&&receiptFile&&Number.isFinite(cpus)&&cpus>0&&cpus<=4,'Missing browser ownership verification inputs');
const [info]=JSON.parse(execFileSync('docker',['inspect',id],{encoding:'utf8',timeout:15000}));
const receipt=verifyBrowserContainer(info,{owner,id,cpus});
writeFileSync(receiptFile,JSON.stringify(receipt)+'\n');
console.log('Verified restored browser container before start: '+JSON.stringify(receipt));
