import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askSecret, SeveralLinesError, type SecretTerminal } from '../src/prompt';

// What a terminal is told so that it marks pastes, and so that it stops.
const PASTE_ON = '\u001b[?2004h';
const PASTE_OFF = '\u001b[?2004l';
const SETTLE_MS = 150;
const PEM = ['-----BEGIN PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '-----END PRIVATE KEY-----'];

// A terminal that records what the prompt does to it and lets a test send keys.
function fakeTerminal() {
  const listeners = new Set<(data: string) => void>();
  const state = { raw: false, reading: false, written: '' };
  const terminal: SecretTerminal = {
    stdin: {
      setRawMode: (mode) => {
        state.raw = mode;
      },
      resume: () => {
        state.reading = true;
      },
      pause: () => {
        state.reading = false;
      },
      setEncoding: () => undefined,
      on: (_event, listener) => listeners.add(listener),
      off: (_event, listener) => listeners.delete(listener),
    },
    stdout: {
      write: (text) => {
        state.written += text;
      },
    },
  };
  return {
    terminal,
    state,
    listening: () => listeners.size > 0,
    send: (keys: string) => {
      for (const listener of [...listeners]) listener(keys);
    },
  };
}

// How the prompt's answer stands now, without waiting for it.
function watch(answer: Promise<string>) {
  const seen: { value?: string; error?: unknown } = {};
  answer.then(
    (value) => {
      seen.value = value;
    },
    (error: unknown) => {
      seen.error = error;
    },
  );
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('askSecret', () => {
  it('shows nothing, asks the terminal to mark pastes, and puts the terminal back when the line is in', async () => {
    const { terminal, state, listening, send } = fakeTerminal();
    const seen = watch(askSecret('Value for KALSHI_API_KEY (not shown)', terminal));

    expect(state.written).toBe(`  Value for KALSHI_API_KEY (not shown): ${PASTE_ON}`);
    expect(state.raw).toBe(true);

    send('sk-live-123\r');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(seen).toEqual({ value: 'sk-live-123' });
    expect(state).toEqual({
      raw: false,
      reading: false,
      written: `  Value for KALSHI_API_KEY (not shown): ${PASTE_ON}${PASTE_OFF}\n`,
    });
    expect(listening()).toBe(false);
    expect(state.written).not.toContain('sk-live-123');
  });

  it('keeps the terminal until it has been silent a moment after Enter', async () => {
    const { terminal, state, listening, send } = fakeTerminal();
    const seen = watch(askSecret('Value', terminal));

    send('sk-live-123\r');
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    expect(seen).toEqual({});
    expect(state.raw).toBe(true);
    expect(listening()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual({ value: 'sk-live-123' });
  });

  it('takes every line of a pasted value of several lines off the terminal, then refuses the whole value', async () => {
    const { terminal, state, listening, send } = fakeTerminal();
    const seen = watch(askSecret('Value', terminal));

    // The lines arrive as typing, a few milliseconds apart.
    for (const line of PEM) {
      send(`${line}\r`);
      await vi.advanceTimersByTimeAsync(20);
      // Still hidden and still read here: nothing is shown, nothing reaches the shell.
      expect(state.raw).toBe(true);
      expect(listening()).toBe(true);
      expect(seen).toEqual({});
    }
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(seen.error).toBeInstanceOf(SeveralLinesError);
    expect(seen.value).toBeUndefined();
    expect(state.raw).toBe(false);
    expect(listening()).toBe(false);
    for (const line of PEM) expect(state.written).not.toContain(line);
  });

  it('refuses a marked paste of several lines as soon as the terminal is silent after its end mark', async () => {
    const { terminal, send } = fakeTerminal();
    const seen = watch(askSecret('Value', terminal));

    send(`\u001b[200~${PEM.join('\r')}\r\u001b[201~`);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(seen.error).toBeInstanceOf(SeveralLinesError);
  });

  it('gives up at once on Ctrl-C', async () => {
    const { terminal, state, listening, send } = fakeTerminal();
    const seen = watch(askSecret('Value', terminal));

    send('sk-\u0003');
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.error).toEqual(new Error('Cancelled. Nothing was set.'));
    expect(state.raw).toBe(false);
    expect(listening()).toBe(false);
    expect(state.written.endsWith(`${PASTE_OFF}\n`)).toBe(true);
  });

  it('counts the keys typed after the Escape key was pressed alone', async () => {
    const { terminal, send } = fakeTerminal();
    const seen = watch(askSecret('Value', terminal));

    // Escape, a pause no key code has inside it, then a value that starts like one.
    send('\u001b');
    await vi.advanceTimersByTimeAsync(400);
    send('[A-key\r');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(seen).toEqual({ value: '[A-key' });
  });

  it('takes an arrow key that arrives in two pieces, close together, for an arrow key', async () => {
    const { terminal, send } = fakeTerminal();
    const seen = watch(askSecret('Value', terminal));

    send('sk-\u001b');
    await vi.advanceTimersByTimeAsync(5);
    send('[D1\r');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(seen).toEqual({ value: 'sk-1' });
  });
});
