import { describe, expect, it } from 'vitest';

import { ApiPayloadError } from '@/api/response';
import { parseActiveUmos, parseSessionGroups, parseSessionRulesData } from './sessionManagementModel';

describe('session management API parsers', () => {
  it('normalizes rule option lists and UMO data', () => {
    const result = parseSessionRulesData({
      available_chat_providers: [{ id: 'provider-1', model: 'model-1' }],
      rules: [{ rules: { session_service_config: { llm_enabled: true } }, umo: 'webchat:friend:user-1' }],
      total: '1',
    });

    expect(result.available_chat_providers).toEqual([{ id: 'provider-1', model: 'model-1', name: undefined }]);
    expect(result.rules?.[0]).toMatchObject({
      message_type: 'friend',
      platform: 'webchat',
      session_id: 'user-1',
      umo: 'webchat:friend:user-1',
    });
    expect(result.total).toBe(1);
  });

  it('parses group and active UMO envelopes', () => {
    expect(parseSessionGroups({ groups: [{ id: 'group-1', umos: ['a', 1] }] })).toEqual([
      { id: 'group-1', name: undefined, umo_count: undefined, umos: ['a'] },
    ]);
    expect(parseActiveUmos({ umo_infos: [{ umo: 'aiocqhttp:group:42' }], umos: ['aiocqhttp:group:42'] }))
      .toMatchObject({ umo_infos: [{ platform: 'aiocqhttp', session_id: '42' }] });
  });

  it('rejects malformed required identifiers at the API boundary', () => {
    expect(() => parseSessionRulesData({ rules: [{ rules: {} }] })).toThrow(ApiPayloadError);
    expect(() => parseSessionGroups({ groups: [{ name: 'missing id' }] })).toThrow(ApiPayloadError);
  });
});
