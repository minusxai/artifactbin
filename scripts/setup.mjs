#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { buildEnvFile, defaultAnswers, parseArgs, questions } from './lib/setup-plan.mjs';

const SECRET_NAMES = ['AUTH__SECRET', 'ADMIN__SECRET', 'CONTRACT__ACTOR_SECRET', 'INTERNAL__SERVICE_SECRET', 'EMAIL__RESEND_API_KEY', 'DATABASE_URL', 'S3_URL'];

function maskSecrets(text) {
  const secretNames = new Set(SECRET_NAMES);
  return text.split('\n').map((line) => {
    const match = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
    return match && secretNames.has(match[1]) && match[2] ? `${match[1]}=************` : line;
  }).join('\n');
}

function generatedSecrets() {
  return {
    AUTH__SECRET: randomBytes(32).toString('base64url'),
    ADMIN__SECRET: randomBytes(32).toString('base64url'),
    CONTRACT__ACTOR_SECRET: randomBytes(32).toString('base64url'),
    INTERNAL__SERVICE_SECRET: randomBytes(32).toString('base64url'),
  };
}

function normaliseChoice(key, value) {
  if (key === 'database') return value === '1' ? 'pglite' : value === '2' ? 'postgres' : value;
  if (key === 'objects') return value === '1' ? 'local' : value === '2' ? 's3' : value;
  if (key === 'port') return Number(value);
  return value;
}

function openTty() {
  let readFd;
  let writeFd;
  try {
    readFd = fs.openSync('/dev/tty', 'r');
    writeFd = fs.openSync('/dev/tty', 'w');
    return {
      input: fs.createReadStream('/dev/tty', { fd: readFd, autoClose: true }),
      output: fs.createWriteStream('/dev/tty', { fd: writeFd, autoClose: true }),
    };
  } catch {
    if (readFd !== undefined) fs.closeSync(readFd);
    if (writeFd !== undefined) fs.closeSync(writeFd);
    return undefined;
  }
}

async function interview(initialAnswers, supplied) {
  const tty = openTty();
  if (!tty) return initialAnswers;

  let muted = false;
  const readlineOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) tty.output.write(chunk, encoding);
      callback();
    },
  });
  const readline = createInterface({ input: tty.input, output: readlineOutput, terminal: true });
  const answers = { ...initialAnswers };

  try {
    for (const question of questions()) {
      if (supplied.has(question.key) || (question.when && !question.when(answers))) continue;
      const fallback = typeof question.default === 'function' ? question.default(answers) : question.default;
      while (true) {
        const suffix = fallback === '' || fallback === undefined ? '' : ` [${fallback}]`;
        tty.output.write(`${question.prompt}${suffix}: `);
        muted = Boolean(question.secret);
        const entered = await new Promise((resolve) => readline.question('', resolve));
        muted = false;
        if (question.secret) tty.output.write('\n');
        const value = entered === '' ? fallback : entered;
        const error = question.validate(value, answers);
        if (!error) {
          answers[question.key] = normaliseChoice(question.key, value);
          break;
        }
        tty.output.write(`${error}\n`);
      }
    }
  } finally {
    readline.close();
    tty.input.destroy();
    tty.output.end();
  }
  return answers;
}

async function main() {
  const argv = process.argv.slice(2);
  const noNext = argv.includes('--no-next');
  const options = parseArgs(argv.filter((arg) => arg !== '--no-next'));
  if (options.error) {
    process.stderr.write(`${options.error}\n`);
    process.exitCode = 3;
    return;
  }

  let answers = defaultAnswers(options.answers);
  if (!options.yes) answers = await interview(answers, new Set(Object.keys(options.answers)));

  let text;
  try {
    text = buildEnvFile(answers, { generated: generatedSecrets() });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
    return;
  }

  if (options.print) {
    process.stdout.write(maskSecrets(text));
    return;
  }
  if (fs.existsSync(options.out) && !options.force) {
    process.stderr.write(`Refusing to overwrite ${options.out} without --force.\nWould write:\n${maskSecrets(text)}`);
    process.exitCode = 2;
    return;
  }

  try {
    fs.writeFileSync(options.out, text, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(options.out, 0o600);
  } catch (error) {
    process.stderr.write(`Could not write ${options.out}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  if (path.basename(options.out) === '.env') {
    process.stdout.write(`Wrote ${options.out}\n${noNext ? '' : 'Next: npm run dev\n'}`);
  } else {
    process.stdout.write(`${options.out}\n`);
  }
}

await main();
