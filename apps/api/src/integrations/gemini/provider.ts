import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getEnv } from '../../config/env.js';
import { ProviderError } from '../../utils/http-error.js';

export interface GenerateInput {
  system: string;
  user: string;
  schema?: Record<string, unknown>;
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(input: GenerateInput): Promise<string>;
  stream(input: GenerateInput): AsyncGenerator<string>;
  embed(texts: string[], task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]>;
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI | null = null;

  isConfigured(): boolean {
    return Boolean(getEnv().GEMINI_API_KEY);
  }

  private sdk(): GoogleGenAI {
    const key = getEnv().GEMINI_API_KEY;
    if (!key) throw new ProviderError('NOT_CONFIGURED', 'Gemini API key is not configured on the server');
    if (!this.client) this.client = new GoogleGenAI({ apiKey: key });
    return this.client;
  }

  async generate(input: GenerateInput): Promise<string> {
    const env = getEnv();
    const response = await this.withRetry(() =>
      this.sdk().models.generateContent({
        model: env.GEMINI_MODEL,
        contents: input.user,
        config: {
          systemInstruction: input.system,
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxOutputTokens ?? 2000,
          abortSignal: input.signal ?? AbortSignal.timeout(25_000),
          responseMimeType: input.schema ? 'application/json' : 'text/plain',
          responseJsonSchema: input.schema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      }),
    );
    const text = response.text?.trim();
    if (!text) throw new ProviderError('BAD_RESPONSE', 'The model returned an empty response');
    return text;
  }

  async *stream(input: GenerateInput): AsyncGenerator<string> {
    const env = getEnv();
    const stream = await this.withRetry(() =>
      this.sdk().models.generateContentStream({
        model: env.GEMINI_MODEL,
        contents: input.user,
        config: {
          systemInstruction: input.system,
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxOutputTokens ?? 2000,
          abortSignal: input.signal ?? AbortSignal.timeout(40_000),
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      }),
    );
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  async embed(texts: string[], task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
    if (!texts.length) return [];
    const env = getEnv();
    const response = await this.withRetry(() =>
      this.sdk().models.embedContent({
        model: env.GEMINI_EMBEDDING_MODEL,
        contents: texts,
        config: {
          taskType: task,
          outputDimensionality: env.GEMINI_EMBEDDING_DIMENSIONS,
        },
      }),
    );
    return (response.embeddings ?? []).map((item) => item.values ?? []);
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const mapped = mapProviderError(error);
      if (mapped.code !== 'RATE_LIMIT' && mapped.code !== 'UNAVAILABLE') throw mapped;
      await new Promise((resolve) => setTimeout(resolve, 700));
      try {
        return await fn();
      } catch (second) {
        throw mapProviderError(second);
      }
    }
  }
}

export function mapProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : 'Gemini request failed';
  const lower = message.toLowerCase();
  if (lower.includes('abort') || lower.includes('timeout')) return new ProviderError('TIMEOUT', 'The model request timed out');
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return new ProviderError('RATE_LIMIT', 'The model provider rate limit was reached');
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('fetch failed')) {
    return new ProviderError('UNAVAILABLE', 'The model provider is unavailable');
  }
  return new ProviderError('BAD_RESPONSE', 'The model provider returned an error');
}

let current: LlmProvider | undefined;

export function getProvider(): LlmProvider {
  if (!current) current = new GeminiProvider();
  return current;
}

export function setProviderForTests(provider?: LlmProvider): void {
  current = provider;
}
