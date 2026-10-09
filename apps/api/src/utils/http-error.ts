export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly code: 'NOT_CONFIGURED' | 'RATE_LIMIT' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
  }
}
