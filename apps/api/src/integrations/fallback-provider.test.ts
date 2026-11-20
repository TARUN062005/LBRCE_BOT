import { describe, expect, it } from 'vitest';
import { FallbackProvider } from './fallback-provider.js';
import type { GenerateInput, LlmProvider } from './gemini/provider.js';
import { ProviderError } from '../utils/http-error.js';

function fake(name: string, behavior: { text?: string; fail?: ProviderError; configured?: boolean }): LlmProvider {
  return {
    name,
    isConfigured: () => behavior.configured !== false,
    async generate() {
      if (behavior.fail) throw behavior.fail;
      return behavior.text ?? '';
    },
    async *stream() {
      if (behavior.fail) throw behavior.fail;
      yield behavior.text ?? '';
    },
    async embed() {
      return [[1]];
    },
  };
}

describe('model fallback', () => {
  const input: GenerateInput = { system: 'test', user: 'hello' };

  it('uses the second model when the first cannot answer', async () => {
    const provider = new FallbackProvider(
      [fake('gemini', { fail: new ProviderError('RATE_LIMIT', 'limited') }), fake('bharatcode', { text: 'from bharatcode' })],
      fake('gemini', {}),
    );
    await expect(provider.generate(input)).resolves.toBe('from bharatcode');
  });

  it('keeps the first answer when that model succeeds', async () => {
    const provider = new FallbackProvider([fake('gemini', { text: 'from gemini' }), fake('bharatcode', { text: 'from bharatcode' })], fake('gemini', {}));
    await expect(provider.generate(input)).resolves.toBe('from gemini');
  });

  it('skips a model that is not configured', async () => {
    const provider = new FallbackProvider(
      [fake('gemini', { configured: false, text: 'no' }), fake('bharatcode', { text: 'from bharatcode' })],
      fake('gemini', {}),
    );
    await expect(provider.generate(input)).resolves.toBe('from bharatcode');
  });
});
