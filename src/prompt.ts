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
