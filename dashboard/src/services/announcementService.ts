import { isRecord, unwrapApiData } from '@/api/response';
import { externalServices } from '@/config/externalServices';
import { sessionStorageKeys } from '@/config/storageKeys';
import { browserStorage, type SafeStorage } from '@/platform/safeStorage';

type AnnouncementCache = {
  expiresAt: number;
  value: unknown;
};

type AnnouncementServiceOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  service?: typeof externalServices.announcement;
  storage?: SafeStorage;
};

function parseCache(raw: string | null): AnnouncementCache | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) && typeof value.expiresAt === 'number' && 'value' in value
      ? { expiresAt: value.expiresAt, value: value.value }
      : null;
  } catch {
    return null;
  }
}

async function requestAnnouncement(url: string, timeoutMs: number, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Announcement request failed with status ${response.status}.`);
    const payload = (await response.json()) as unknown;
    const data = unwrapApiData(payload);
    if (!isRecord(data)) return null;
    const notice = isRecord(data.notice) ? data.notice : {};
    return notice.welcome_page ?? null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function loadWelcomeAnnouncement(options: AnnouncementServiceOptions = {}) {
  const service = options.service ?? externalServices.announcement;
  if (!service.enabled) return null;
  const now = options.now ?? Date.now;
  const storage = options.storage ?? browserStorage('session');
  const cached = parseCache(storage.get(sessionStorageKeys.announcementCache));
  if (cached && cached.expiresAt > now()) return cached.value;

  const fetchImpl = options.fetch ?? fetch;
  for (let attempt = 0; attempt <= service.retries; attempt += 1) {
    try {
      const value = await requestAnnouncement(service.url, service.timeoutMs, fetchImpl);
      storage.set(
        sessionStorageKeys.announcementCache,
        JSON.stringify({ expiresAt: now() + service.cacheTtlMs, value } satisfies AnnouncementCache),
      );
      return value;
    } catch {
      // Public announcements are optional; retry only within the configured small budget.
    }
  }
  return cached?.value ?? null;
}
