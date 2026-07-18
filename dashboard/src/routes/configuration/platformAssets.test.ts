import { describe, expect, it } from 'vitest';

import { hasScanAndManualCreation, isScanOnlyCreation, platformLogo, scanRegistrationComplete } from './platformAssets';

describe('platform assets and creation modes', () => {
  it('maps built-in platform logos and plugin logo tokens', () => {
    expect(platformLogo('qq_official')).toContain('qq');
    expect(platformLogo('aiocqhttp')).toContain('onebot');
    expect(platformLogo('plugin', { logo_token: 'logo/a+b' })).toBe('/api/v1/files/tokens/logo%2Fa%2Bb');
  });

  it('uses the legacy scan/manual creation modes', () => {
    expect(hasScanAndManualCreation('lark')).toBe(true);
    expect(hasScanAndManualCreation('dingtalk')).toBe(true);
    expect(hasScanAndManualCreation('qq_official_webhook')).toBe(true);
    expect(hasScanAndManualCreation('telegram')).toBe(false);
    expect(isScanOnlyCreation('weixin_oc')).toBe(true);
  });

  it('requires the credentials returned by each registration flow', () => {
    expect(scanRegistrationComplete('lark', { app_id: 'id', app_secret: 'secret' })).toBe(true);
    expect(scanRegistrationComplete('dingtalk', { client_id: 'id' })).toBe(false);
    expect(scanRegistrationComplete('qq_official', { appid: 'id', secret: 'secret' })).toBe(true);
    expect(scanRegistrationComplete('weixin_oc', { weixin_oc_token: 'token' })).toBe(true);
  });
});
