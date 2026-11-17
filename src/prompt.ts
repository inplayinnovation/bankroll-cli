import { createInterface } from 'node:readline/promises';

/**
 * Ask for a value, or take what was passed.
 *
 * Without a terminal there is nothing to ask, so a missing required answer is an
 * error rather than a hang — a CI run must fail, not wait forever.
 */
export async function ask(
  provided: string | undefined,
  question: string,
  options: { required?: boolean } = {},
): Promise<string | undefined> {
  if (provided !== undefined) return provided;

  if (!process.stdin.isTTY) {
    if (options.required) throw new Error(`${question} is required when there is no terminal`);
    return undefined;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`  ${question}: `)).trim();
    if (answer) return answer;
    if (options.required) throw new Error(`${question} is required`);
    return undefined;
  } finally {
    rl.close();
  }
}

/**
 * A yes or no, yes unless said otherwise. Without a terminal the answer is
 * the default: a shell nobody watches, a coding agent's, gets on with it.
 */
export async function confirm(question: string, fallback = true): Promise<boolean> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`  ${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    if (!answer) return fallback;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

const ENTER = new Set(['\r', '\n']);
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u007f', '\b']);

/** What the keys typed so far amount to: the value, and whether the line ended or was given up. */
export function typedSecret(keys: string, value = ''): { value: string; done: 'entered' | 'cancelled' | null } {
  for (const key of keys) {
    if (ENTER.has(key) || key === CTRL_D) return { value, done: 'entered' };
    if (key === CTRL_C) return { value: '', done: 'cancelled' };
    value = BACKSPACE.has(key) ? value.slice(0, -1) : value + key;
  }
  return { value, done: null };
}

/**
 * Ask for a value that must not be shown: nothing typed or pasted is echoed,
 * so it is not left on the screen or in a recording of it. One line; a value
 * of several lines, such as a PEM key, comes from a file instead. The caller
 * has checked that there is a terminal.
 */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stdout.write(`  ${question}: `);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const onData = (keys: string) => {
      const typed = typedSecret(keys, value);
      value = typed.value;
      if (typed.done === null) return;
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (typed.done === 'cancelled') reject(new Error('Cancelled. Nothing was set.'));
      else resolve(value);
    };
    input.on('data', onData);
  });
}
