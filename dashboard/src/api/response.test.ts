import { describe, expect, it } from 'vitest';

import { ApiPayloadError, decodeApiData, expectRecord, unwrapApiData } from './response';

describe('API response decoding', () => {
  it('unwraps generated-client Axios responses and raw envelopes', () => {
    expect(unwrapApiData({ data: { status: 'ok', data: { value: 1 } } })).toEqual({ value: 1 });
    expect(unwrapApiData({ status: 'ok', data: { value: 2 } })).toEqual({ value: 2 });
  });

  it('rejects API error envelopes before they reach a page', () => {
    expect(() =>
      unwrapApiData({
        data: { status: 'error', message: 'invalid config' },
      }),
    ).toThrow('invalid config');
  });

  it('wraps parser failures with domain and payload context', () => {
    let error: unknown;
    try {
      decodeApiData({ data: { status: 'ok', data: [] } }, (value) => expectRecord(value), 'provider');
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ApiPayloadError);
    expect(error).toMatchObject({
      message: expect.stringContaining('Invalid provider'),
      payload: [],
    });
  });
});
