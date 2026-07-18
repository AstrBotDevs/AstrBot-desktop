import type { AuthSession } from '@/auth/storage';
import { parseProviderSchema } from '@/api/domain';
import { decodeApiData, expectRecord, optionalRecord } from '@/api/response';

export function sessionNeedsPasswordSetup(session: AuthSession) {
  return Boolean(session.changePwdHint || (session.md5PwdHint && !session.passwordUpgradeRequired));
}

export function sanitizeReturnUrl(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (path === '/auth/login' || path === '/auth/setup') return null;
  return value;
}

export async function checkOnboardingCompleted(): Promise<boolean> {
  try {
    const { getProviderSchema, getSystemConfig } = await import('@/api/openapi');
    const configResponse = await getSystemConfig();
    const configData = decodeApiData(configResponse, (value) => expectRecord(value, 'system config'), 'system config');
    const platforms = optionalRecord(configData.config)?.platform;
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return false;
    }

    const providerResponse = await getProviderSchema();
    const providerData = decodeApiData(providerResponse, parseProviderSchema, 'provider schema');
    const sourceTypes = new Map(providerData.providerSources.map((source) => [source.id, source.provider_type]));
    return providerData.providers.some(
      (provider) =>
        provider.provider_type === 'chat_completion' ||
        sourceTypes.get(provider.provider_source_id || '') === 'chat_completion' ||
        String(provider.type ?? '').includes('chat_completion'),
    );
  } catch {
    return false;
  }
}

export async function resolveAuthenticatedRoute(
  session: AuthSession,
  onboardingCheck: () => Promise<boolean> = checkOnboardingCompleted,
  returnUrl?: string | null,
) {
  if (sessionNeedsPasswordSetup(session)) return '/auth/setup';
  if (!(await onboardingCheck())) return '/welcome';
  return sanitizeReturnUrl(returnUrl) ?? '/dashboard/default';
}
