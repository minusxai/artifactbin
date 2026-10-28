import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {hostDirectory} from '../src/config';

test('credential folders expose the origin while keeping scheme and port isolated',()=>{
 const home='/private-test-home';
 assert.equal(hostDirectory('https://app.artifactbin.dev',home,{}),join(home,'.artifactbin','hosts','app.artifactbin.dev'));
 assert.equal(hostDirectory('https://example.com:8443',home,{}),join(home,'.artifactbin','hosts','example.com@https-8443'));
 assert.equal(hostDirectory('http://localhost:7445',home,{}),join(home,'.artifactbin','hosts','localhost@http-7445'));
 assert.notEqual(hostDirectory('https://localhost:7445',home,{}),hostDirectory('http://localhost:7445',home,{}));
});

test('credential folders encode IPv6, canonical IDN and Windows reserved names safely',()=>{
 const home='/private-test-home';
 assert.equal(hostDirectory('http://[::1]:7445',home,{}),join(home,'.artifactbin','hosts','%5B%3A%3A1%5D@http-7445'));
 assert.equal(hostDirectory('https://bücher.example',home,{}),hostDirectory('https://xn--bcher-kva.example',home,{}));
 assert.equal(hostDirectory('https://con.example',home,{}),join(home,'.artifactbin','hosts','%63on.example'));
 assert.equal(hostDirectory('https://example.com.',home,{}),join(home,'.artifactbin','hosts','example.com%2E'));
});
