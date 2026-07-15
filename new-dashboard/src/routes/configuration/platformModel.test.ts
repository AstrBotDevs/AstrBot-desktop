import { describe, expect, it } from 'vitest';
import { isValidPlatformId, mergePlatformTemplate, platformQrPayload, platformTemplates, webhookUrl } from './platformModel';

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
});
