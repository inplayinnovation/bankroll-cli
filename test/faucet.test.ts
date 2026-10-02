import { describe, expect, it } from 'vitest';

import { dollars } from '../src/faucet';

describe('dollars', () => {
  it('drops the cents from a whole amount and keeps them otherwise', () => {
    expect(dollars(10_000)).toBe('$100');
    expect(dollars(1_250)).toBe('$12.50');
    expect(dollars(5)).toBe('$0.05');
  });
});
