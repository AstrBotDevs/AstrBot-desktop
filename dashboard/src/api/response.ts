export type UnknownRecord = Record<string, unknown>;
export type RuntimeParser<T> = (value: unknown) => T;

export class ApiPayloadError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.name = 'ApiPayloadError';
    this.payload = payload;
  }
}

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapApiData(response: unknown): unknown {
  if (!isRecord(response)) return response;

  const body = 'data' in response ? response.data : response;
  if (!isRecord(body)) return body;
  if (body.status === 'error') {
    throw new ApiPayloadError(
      typeof body.message === 'string' && body.message ? body.message : 'API returned an error response.',
      body,
    );
  }
  if (body.status === 'ok' && 'data' in body) return body.data;
  return body;
}

export function decodeApiData<T>(response: unknown, parser: RuntimeParser<T>, domain = 'API response'): T {
  const payload = unwrapApiData(response);
  try {
    return parser(payload);
  } catch (cause) {
    const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : '';
    throw new ApiPayloadError(`Invalid ${domain}.${detail}`, payload);
  }
}

/**
 * Compatibility entry point for dynamic endpoints whose OpenAPI response data
 * is still `unknown`. New domain code should call `decodeApiData` with a parser.
 */
export function responseData<T = unknown>(response: unknown): T {
  return unwrapApiData(response) as T;
}

export function expectRecord(value: unknown, domain = 'object'): UnknownRecord {
  if (!isRecord(value)) throw new ApiPayloadError(`Expected ${domain} to be an object.`, value);
  return value;
}

export function optionalRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}
