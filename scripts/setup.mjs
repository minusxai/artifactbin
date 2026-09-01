#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { buildEnvFile, defaultAnswers, existingAnswers, mergeEnvFile, parseArgs, questions } from './lib/setup-plan.mjs';

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

const CANCELLED = Symbol('setup-cancelled');

async function visibleAnswer(prompt) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([
      readline.question(prompt),
      new Promise((resolve) => readline.once('SIGINT', () => resolve(CANCELLED))),
    ]);
  } finally {
    readline.close();
  }
}

function secretAnswer(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let answer = '';
    const finish = (value) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk) => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 3) return finish(CANCELLED); // Ctrl-C
        if (byte === 13 || byte === 10) return finish(answer);
        if (byte === 8 || byte === 127) {
          if (answer) {
            answer = answer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (byte >= 32 && byte <= 126) {
          answer += String.fromCharCode(byte);
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function interview(initialAnswers, supplied) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return initialAnswers;
  const answers = { ...initialAnswers };

  for (const question of questions()) {
    if (supplied.has(question.key) || (question.when && !question.when(answers))) continue;
    const fallback = typeof question.default === 'function' ? question.default(answers) : question.default;
    const current = answers[question.key] ?? fallback;
    while (true) {
      const suffix = question.secret
        ? (current
            ? ` [configured; Enter keeps it${question.clearable ? ', type - to clear' : ''}]`
            : ` [${question.clearable ? 'Enter to skip; ' : ''}input is hidden]`)
        : (current === '' || current === undefined ? '' : ` [${current}]`);
      const prompt = `${question.prompt}${suffix}: `;
      const entered = question.secret ? await secretAnswer(prompt) : await visibleAnswer(prompt);
      if (entered === CANCELLED) return null;
      const keeping = entered === '';
      const value = keeping ? current : (question.clearable && entered === '-' ? '' : entered);
      // A rerun must be able to retain a value accepted by the application,
      // even if this setup version's stricter editor would not create it.
      const error = keeping ? undefined : question.validate(value, answers);
      if (!error) {
        answers[question.key] = normaliseChoice(question.key, value);
        supplied.add(question.key);
        break;
      }
      process.stdout.write(`${error}\n`);
    }
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

  // --print is a clean preview of the requested choices, independent of a
  // checkout's current file. Writing without --force is the merge/edit path.
  const existingText = !options.print && fs.existsSync(options.out) ? fs.readFileSync(options.out, 'utf8') : '';
  const supplied = new Set(Object.keys(options.answers));
  let answers = existingText && !options.force
    ? { ...existingAnswers(existingText), ...options.answers }
    : defaultAnswers(options.answers);
  if (!options.yes) {
    if (existingText && !options.force) {
      process.stdout.write(`Existing ${options.out} found.\nPress Enter to keep a value, or type a replacement; type - to clear an optional secret.\n\n`);
    }
    answers = await interview(answers, supplied);
    if (answers === null) {
      process.stdout.write('\nSetup cancelled; .env was not changed.\n');
      process.exitCode = 130;
      return;
    }
  }

  let text;
  try {
    text = existingText && !options.force
      ? mergeEnvFile(existingText, answers, { generated: generatedSecrets(), supplied })
      : buildEnvFile(answers, { generated: generatedSecrets() });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
    return;
  }

  if (options.print) {
    process.stdout.write(maskSecrets(text));
    return;
  }
  if (existingText === text) {
    process.stdout.write(`${options.out} is already configured; no changes made.\n${noNext ? '' : 'Next: npm run dev\n'}`);
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
