import type { GenerateInput, LlmProvider, WebAnswer } from './gemini/provider.js';
import { ProviderError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

export class FallbackProvider implements LlmProvider {
  readonly name = 'gemini+bharatcode';

  constructor(
    private readonly providers: LlmProvider[],
    private readonly embedder: LlmProvider,
  ) {}

  isConfigured(): boolean {
    return this.providers.some((provider) => provider.isConfigured());
  }

  async generate(input: GenerateInput): Promise<string> {
    return this.first((provider) => provider.generate(input), input.signal);
  }

  async *stream(input: GenerateInput): AsyncGenerator<string> {
    const ready = this.ready();
    if (!ready.length) throw new ProviderError('NOT_CONFIGURED', 'No model API key is configured');
    let last: unknown;
    for (let index = 0; index < ready.length; index += 1) {
      if (input.signal?.aborted) throw new ProviderError('TIMEOUT', 'The model request timed out');
      let yielded = false;
      try {
        for await (const token of ready[index]!.stream(input)) {
          if (!token) continue;
          yielded = true;
          yield token;
        }
        if (yielded || index === ready.length - 1) return;
      } catch (error) {
        if (yielded || input.signal?.aborted) throw error;
        last = error;
        this.noteFailure(ready[index]!, error);
      }
    }
    throw this.asError(last);
  }

  async searchWeb(input: GenerateInput & { onToken?: (token: string) => void }): Promise<WebAnswer> {
    return this.first((provider) => {
      if (!provider.searchWeb) throw new ProviderError('NOT_CONFIGURED', `${provider.name} has no web search`);
      return provider.searchWeb(input);
    }, input.signal);
  }

  async readDocument(input: GenerateInput & { mimeType: string; data: Buffer; onToken?: (token: string) => void }): Promise<string> {
    return this.first((provider) => {
      if (!provider.readDocument) throw new ProviderError('NOT_CONFIGURED', `${provider.name} cannot read files`);
      return provider.readDocument(input);
    }, input.signal);
  }

  embed(texts: string[], task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
    return this.embedder.embed(texts, task);
  }

  private ready(): LlmProvider[] {
    return this.providers.filter((provider) => provider.isConfigured());
  }

  private async first<T>(run: (provider: LlmProvider) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const ready = this.ready();
    if (!ready.length) throw new ProviderError('NOT_CONFIGURED', 'No model API key is configured');
    let last: unknown;
    for (const provider of ready) {
      if (signal?.aborted) throw new ProviderError('TIMEOUT', 'The model request timed out');
      try {
        return await run(provider);
      } catch (error) {
        if (signal?.aborted) throw error;
        const mapped = this.asError(error);
        if (mapped.code === 'NOT_CONFIGURED') continue;
        last = mapped;
        this.noteFailure(provider, mapped);
      }
    }
    throw this.asError(last);
  }

  private noteFailure(provider: LlmProvider, error: unknown): void {
    const code = error instanceof ProviderError ? error.code : 'BAD_RESPONSE';
    logger.warn({ provider: provider.name, code }, 'model provider failed, trying the next configured provider');
  }

  private asError(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error;
    return new ProviderError('UNAVAILABLE', 'The model providers are unavailable');
  }
}
