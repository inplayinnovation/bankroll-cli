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
const ESCAPE = '\u001b';
// A terminal that is asked to mark pastes (PASTE_ON) puts PASTE_START and
// PASTE_END around each one, so a paste is told apart from typing and its end
// is known.
const PASTE_ON = '\u001b[?2004h';
const PASTE_OFF = '\u001b[?2004l';
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
// How long the terminal must be silent after the line ends before the prompt
// lets go of it. On a terminal that marks no pastes, the lines of a pasted
// value arrive as typing, a few milliseconds apart.
const SETTLE_MS = 150;
// An Escape that nothing followed for this long was the Escape key, not the
// start of a mark or of another key's code, which arrive in one piece.
const ESCAPE_ALONE_MS = 50;
const FIRST_FINAL = 0x40;
const LAST_FINAL = 0x7e;

/** How a hidden line ended: with Enter, with Ctrl-C, or with more lines than the one it takes. */
export type SecretEnd = 'entered' | 'cancelled' | 'several-lines';

/** What the keys so far amount to. */
export interface SecretKeys {
  /** The value so far. */
  value: string;
  /** How the line ended, or null while it has not. */
  done: SecretEnd | null;
  /** The text of a paste the terminal marked, until its end mark comes. Null outside one. */
  paste: string | null;
  /** The last characters that arrived, held back because they may begin a mark or a key's code. */
  held: string;
}

export const NO_KEYS: SecretKeys = { value: '', done: null, paste: null, held: '' };

/** The value pasted or typed has more than the one line the prompt takes. Nothing of it is kept. */
export class SeveralLinesError extends Error {
  constructor() {
    super('The value has more than one line, and the prompt takes one.');
    this.name = 'SeveralLinesError';
  }
}

const withoutLast = (text: string): string => Array.from(text).slice(0, -1).join('');

// Whether the text from `at` to its end begins `mark` and stops short of it.
const beginsMark = (text: string, at: number, mark: string): boolean =>
  text.length - at < mark.length && mark.startsWith(text.slice(at));

// The length of the code that the Escape at `at` begins: an arrow or a
// function key. 1 when the Escape stands alone before an ordinary key, and 0
// when the rest of the code has not arrived.
function keyCodeLength(text: string, at: number): number {
  const next = text[at + 1];
  if (next === undefined) return 0;
  if (next === '[') {
    for (let end = at + 2; end < text.length; end += 1) {
      const code = text.charCodeAt(end);
      if (code >= FIRST_FINAL && code <= LAST_FINAL) return end - at + 1;
    }
    return 0;
  }
  if (next === 'O') return at + 2 < text.length ? 3 : 0;
  return 1;
}

// A marked paste, now that its end mark has come. One line joins the value,
// and its own line break enters it, as it does on a terminal that marks no
// pastes. More lines than one end the prompt with nothing kept.
function pasted(value: string, paste: string): Pick<SecretKeys, 'value' | 'done'> {
  const text = paste.replace(/\r\n?/g, '\n');
  const entered = text.endsWith('\n');
  const line = entered ? text.slice(0, -1) : text;
  if (line.includes('\n')) return { value: '', done: 'several-lines' };
  return { value: value + line, done: entered ? 'entered' : null };
}

/**
 * What the keys so far amount to, given what earlier keys amounted to.
 *
 * The line takes one value on one line. After Enter, anything more that is
 * not a line break means several lines were pasted on a terminal that marks
 * no pastes: the answer is 'several-lines', never the first line alone. A key
 * that prints nothing, such as an arrow, adds nothing to the value.
 */
export function typedSecret(keys: string, before: SecretKeys = NO_KEYS): SecretKeys {
  let { value, done, paste } = before;
  const text = before.held + keys;
  let held = '';
  let at = 0;
  while (at < text.length) {
    if (done === 'cancelled') break;
    const key = String.fromCodePoint(text.codePointAt(at) as number);
    if (done !== null) {
      // The line has ended. What still arrives is taken off the terminal and
      // dropped; anything but a line break makes it more lines than one.
      if (!ENTER.has(key)) {
        value = '';
        done = 'several-lines';
      }
      at += key.length;
    } else if (paste !== null) {
      if (text.startsWith(PASTE_END, at)) {
        ({ value, done } = pasted(value, paste));
        paste = null;
        at += PASTE_END.length;
      } else if (beginsMark(text, at, PASTE_END)) {
        held = text.slice(at);
        break;
      } else {
        paste += key;
        at += key.length;
      }
    } else if (key === ESCAPE) {
      if (text.startsWith(PASTE_START, at)) {
        paste = '';
        at += PASTE_START.length;
      } else if (beginsMark(text, at, PASTE_START)) {
        held = text.slice(at);
        break;
      } else {
        const length = keyCodeLength(text, at);
        if (length === 0) {
          held = text.slice(at);
          break;
        }
        at += length;
      }
    } else {
      if (ENTER.has(key) || key === CTRL_D) done = 'entered';
      else if (key === CTRL_C) {
        value = '';
        done = 'cancelled';
      } else value = BACKSPACE.has(key) ? withoutLast(value) : value + key;
      at += key.length;
    }
  }
  return { value, done, paste, held };
}

/** The terminal a hidden line is read from: this process's own, or a stand-in under test. */
export interface SecretTerminal {
  stdin: {
    setRawMode(mode: boolean): unknown;
    resume(): unknown;
    pause(): unknown;
    setEncoding(encoding: 'utf8'): unknown;
    on(event: 'data', listener: (data: string) => void): unknown;
    off(event: 'data', listener: (data: string) => void): unknown;
  };
  stdout: { write(text: string): unknown };
}

/**
 * Ask for a value that must not be shown: nothing typed or pasted is echoed,
 * so it is not left on the screen or in a recording of it. One line; a value
 * of several lines, such as a PEM key, comes from a file or a pipe instead,
 * and pasting one here is refused with SeveralLinesError, whole: no line of
 * it is kept, shown, or left on the terminal for the shell to read as
 * commands. The caller has checked that there is a terminal.
 */
export function askSecret(question: string, terminal: SecretTerminal = process): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = terminal.stdin;
    terminal.stdout.write(`  ${question}: ${PASTE_ON}`);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let keys = NO_KEYS;
    let heldAt = 0;
    let settling: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      terminal.stdout.write(`${PASTE_OFF}\n`);
      if (keys.done === 'cancelled') reject(new Error('Cancelled. Nothing was set.'));
      else if (keys.done === 'several-lines') reject(new SeveralLinesError());
      else resolve(keys.value);
    };
    const onData = (data: string) => {
      const alone = keys.held === ESCAPE && Date.now() - heldAt > ESCAPE_ALONE_MS;
      keys = typedSecret(data, alone ? { ...keys, held: '' } : keys);
      heldAt = Date.now();
      if (keys.done === null) return;
      clearTimeout(settling);
      if (keys.done === 'cancelled') finish();
      // The line has ended, and the terminal still shows nothing. Whatever
      // else is on its way is taken here until it has been silent a moment.
      else settling = setTimeout(finish, SETTLE_MS);
    };
    input.on('data', onData);
  });
}
