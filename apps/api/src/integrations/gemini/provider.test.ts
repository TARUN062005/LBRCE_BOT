import { describe, expect, it } from 'vitest';
import { retryDelayMs } from './provider.js';

describe('Gemini retry spacing', () => {
  it('honours the retry delay reported by the provider', () => {
    const error = new Error('Resource exhausted. Please retry in 3.5s.');
    expect(retryDelayMs(error, 0)).toBe(3750);
  });

  it('backs off when the provider does not give a delay', () => {
    expect(retryDelayMs(new Error('429'), 0)).toBe(1000);
    expect(retryDelayMs(new Error('429'), 2)).toBe(4000);
  });
});
