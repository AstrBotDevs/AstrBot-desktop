import { describe, expect, it, vi } from 'vitest';

import {
  resolveAuthenticatedRoute,
  sanitizeReturnUrl,
  sessionNeedsPasswordSetup,
} from './sessionFlow';

const session = { token: 'token', username: 'astrbot' };

describe('authenticated session flow', () => {
  it('keeps legacy password warning precedence', () => {
    expect(sessionNeedsPasswordSetup({ ...session, changePwdHint: true })).toBe(true);
    expect(sessionNeedsPasswordSetup({ ...session, md5PwdHint: true })).toBe(true);
    expect(sessionNeedsPasswordSetup({
      ...session,
      md5PwdHint: true,
      passwordUpgradeRequired: true,
    })).toBe(false);
  });

  it('routes password warnings to setup before checking onboarding', async () => {
    const onboardingCheck = vi.fn(async () => true);
    await expect(resolveAuthenticatedRoute(
      { ...session, changePwdHint: true },
      onboardingCheck,
    )).resolves.toBe('/auth/setup');
    expect(onboardingCheck).not.toHaveBeenCalled();
  });

  it('routes completed and incomplete onboarding to legacy-compatible pages', async () => {
    await expect(resolveAuthenticatedRoute(session, async () => true))
      .resolves.toBe('/dashboard/default');
    await expect(resolveAuthenticatedRoute(session, async () => false))
      .resolves.toBe('/welcome');
  });

  it('restores a safe protected target after authentication', async () => {
    await expect(resolveAuthenticatedRoute(
      session,
      async () => true,
      '/knowledge-base/kb-1?tab=documents',
    )).resolves.toBe('/knowledge-base/kb-1?tab=documents');
    await expect(resolveAuthenticatedRoute(session, async () => false, '/providers'))
      .resolves.toBe('/welcome');
  });

  it('rejects external and recursive authentication targets', () => {
    expect(sanitizeReturnUrl('https://example.com')).toBeNull();
    expect(sanitizeReturnUrl('//example.com')).toBeNull();
    expect(sanitizeReturnUrl('/auth/login?redirect=/settings')).toBeNull();
    expect(sanitizeReturnUrl('/settings#security')).toBe('/settings#security');
  });
});
