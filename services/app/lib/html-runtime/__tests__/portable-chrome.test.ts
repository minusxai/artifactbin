import { expect, it } from 'vitest';
import { portablePublishOrigin } from '../portable-chrome-contract';
it.each([
  ['https://platform.example', 'https://platform.example'], [' https://platform.example/ ', 'https://platform.example'],
  ['http://localhost:3030', 'http://localhost:3030'], ['http://127.0.0.1:3030', 'http://127.0.0.1:3030'], ['http://[::1]:3030', 'http://[::1]:3030'],
  ['http://platform.example', null], ['https://person:secret@platform.example', null], ['https://platform.example/path', null],
  ['https://platform.example?token=secret', null], ['https://platform.example#section', null], ['file:///tmp/page.html', null], ['', null],
])('validates an explicit publish origin %s', (input, expected) => { expect(portablePublishOrigin(input)).toBe(expected); });
