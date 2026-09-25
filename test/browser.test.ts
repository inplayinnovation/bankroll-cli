import { describe, expect, it } from 'vitest';

import { browserCommand } from '../src/browser';

describe('browserCommand', () => {
  it("uses each platform's own opener", () => {
    expect(browserCommand('darwin')).toEqual(['open', []]);
    expect(browserCommand('linux')).toEqual(['xdg-open', []]);
    expect(browserCommand('win32')).toEqual(['cmd', ['/c', 'start', '']]);
  });
});
