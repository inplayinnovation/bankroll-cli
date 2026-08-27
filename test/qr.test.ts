import { describe, expect, it } from 'vitest';

import { qrLines, qrTextLines } from '../src/qr';

const LINK = 'https://joinbankroll.com/play?url=https%3A%2F%2Fexample.trycloudflare.com%2Fapp';

describe('qrTextLines', () => {
  // This form exists to be re-printed into a chat transcript, where ANSI is
  // stripped — so its entire information content must be in the glyphs.
  it('carries all contrast in glyphs — no escape codes', () => {
    const lines = qrTextLines(LINK);
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line).toMatch(/^[█▀▄ ]*$/);
    }
  });

  it('renders both light and dark modules', () => {
    const body = qrTextLines(LINK).join('\n');
    expect(body).toContain('█');
    expect(body).toContain(' ');
  });
});

describe('qrLines', () => {
  // The TTY form colors every cell explicitly, dark-on-light, so a dark
  // terminal cannot invert it.
  it('colors cells with explicit ANSI codes', () => {
    expect(qrLines(LINK).join('')).toContain('[38;5;');
  });
});
