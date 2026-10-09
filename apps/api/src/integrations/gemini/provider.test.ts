import { describe, expect, it } from 'vitest';
import { mapProviderError } from './provider.js';

describe('provider errors', () => {
  it('maps quota and outage failures without exposing a key', () => {
    expect(mapProviderError(new Error('429 RESOURCE_EXHAUSTED quota')).code).toBe('RATE_LIMIT');
    expect(mapProviderError(new Error('503 UNAVAILABLE')).code).toBe('UNAVAILABLE');
    expect(mapProviderError(new Error('The user aborted a request')).code).toBe('TIMEOUT');
    expect(mapProviderError(new Error('bad json')).message).not.toMatch(/AIza|GEMINI_API_KEY/);
  });
});
