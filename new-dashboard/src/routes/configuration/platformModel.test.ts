import { describe, expect, it } from 'vitest';
import {
  emptyPlatformRoute,
  hasPlatformIdConflict,
  hasUnsafeOneBotToken,
  isValidPlatformId,
  mergePlatformTemplate,
  parsePlatformUmo,
  platformQrPayload,
  platformRoutes,
  platformTemplates,
  replacePlatformRouting,
  webhookUrl,
} from './platformModel';

describe('platform model', () => {
  it('keeps template order/defaults and preserves unknown legacy fields', () => {
    const merged = mergePlatformTemplate({ id: 'bot', nested: { kept: 2 }, legacy: true }, { type: 'telegram', id: '', nested: { kept: 0, added: 3 } });
    expect(Object.keys(merged)).toEqual(['type', 'id', 'nested', 'legacy']);
    expect(merged).toEqual({ type: 'telegram', id: 'bot', nested: { kept: 2, added: 3 }, legacy: true });
  });

  it('reads platform templates from runtime metadata', () => {
    expect(platformTemplates({ platform_group: { metadata: { platform: { config_template: { telegram: { type: 'telegram' } } } } } })).toEqual({ telegram: { type: 'telegram' } });
  });

  it('finds nested QR data and creates webhook URLs', () => {
    expect(platformQrPayload({ adapter: { qrcode_img_content: 'data:image/png;base64,abc', qr_status: 'pending' } })).toEqual({ payload: 'data:image/png;base64,abc', status: 'pending' });
    expect(webhookUrl({ callback_api_base: 'https://bot.example/' }, 'uuid')).toBe('https://bot.example/api/v1/webhooks/platforms/uuid');
  });

  it('validates IDs using the legacy restrictions', () => {
    expect(isValidPlatformId('telegram-main')).toBe(true);
    expect(isValidPlatformId('bad:id')).toBe(false);
    expect(isValidPlatformId('bad id')).toBe(false);
  });

  it('detects duplicate IDs and an empty aiocqhttp reverse token', () => {
    expect(hasPlatformIdConflict('webchat', [])).toBe(true);
    expect(hasPlatformIdConflict('telegram', ['telegram'])).toBe(true);
    expect(hasPlatformIdConflict('discord', ['telegram'])).toBe(false);
    expect(hasUnsafeOneBotToken('aiocqhttp', '  ')).toBe(true);
    expect(hasUnsafeOneBotToken('aiocqhttp', 'secret')).toBe(false);
    expect(hasUnsafeOneBotToken('telegram', '')).toBe(false);
  });

  it('parses and filters platform routes while preserving colon-containing session IDs', () => {
    expect(parsePlatformUmo('qq:GroupMessage:room:42')).toEqual({
      platform: 'qq',
      messageType: 'GroupMessage',
      sessionId: 'room:42',
    });
    expect(platformRoutes({
      'qq:*:*': 'default',
      'qq:GroupMessage:room:42': 'group',
      'telegram:*:*': 'telegram',
    }, 'qq')).toEqual([
      emptyPlatformRoute(),
      { configId: 'group', messageType: 'GroupMessage', sessionId: 'room:42', sourceUmo: 'qq:GroupMessage:room:42' },
    ]);
    expect(platformRoutes({}, 'qq')).toEqual([emptyPlatformRoute()]);
  });

  it('replaces only old and new platform routing entries', () => {
    expect(replacePlatformRouting({
      'old:*:*': 'default',
      'old:GroupMessage:room': 'group',
      'new:FriendMessage:stale': 'stale',
      'other:*:*': 'other',
    }, 'old', 'new', [
      { configId: 'next', messageType: '*', sessionId: '*' },
      { configId: 'friend', messageType: 'FriendMessage', sessionId: 'alice' },
    ])).toEqual({
      'other:*:*': 'other',
      'new:*:*': 'next',
      'new:FriendMessage:alice': 'friend',
    });
  });
});
