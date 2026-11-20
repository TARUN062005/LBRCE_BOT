import { describe, expect, it } from 'vitest';
import { chatCompletionText, deltaFromSseLine } from './provider.js';

describe('BharatCode responses', () => {
  it('reads chat completion text', () => {
    expect(chatCompletionText({ choices: [{ message: { content: 'Hello from BharatCode' } }] })).toBe('Hello from BharatCode');
  });

  it('reads a streamed token and ignores the done marker', () => {
    expect(deltaFromSseLine('data: {"choices":[{"delta":{"content":"Hi"}}]}')).toBe('Hi');
    expect(deltaFromSseLine('data: [DONE]')).toBe('');
  });
});
