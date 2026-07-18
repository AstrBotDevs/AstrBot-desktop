import { DEFAULT_CONFIG_ID, DEFAULT_PLATFORM_ID } from '@/config/defaults';
import { selectedConfigPreference } from '@/config/preferences';
import { storageKeys } from '@/config/storageKeys';

export const CHAT_SELECTED_CONFIG_STORAGE_KEY = storageKeys.chat.selectedConfigId;

export type ConfigRouteEntry = {
  pattern: string;
  configId: string;
};

function storageValue(key: string, fallback: string) {
  try {
    return localStorage.getItem(key)?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function storedChatConfigId() {
  return selectedConfigPreference.read() || DEFAULT_CONFIG_ID;
}

export function storeChatConfigId(configId: string) {
  try {
    selectedConfigPreference.write(configId || DEFAULT_CONFIG_ID);
  } catch {
    // Storage can be unavailable in private or embedded contexts.
  }
}

export function buildWebchatUmo(sessionId: string, platformId = DEFAULT_PLATFORM_ID, isGroup = false) {
  const username = storageValue(storageKeys.auth.username, 'guest');
  const messageType = isGroup ? 'GroupMessage' : 'FriendMessage';
  return `${platformId}:${messageType}:${platformId}!${username}!${sessionId}`;
}

export function configRouteEntries(value: unknown): ConfigRouteEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const routing = (value as { routing?: unknown }).routing;
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return [];
  return Object.entries(routing).map(([pattern, configId]) => ({
    pattern,
    configId: String(configId || DEFAULT_CONFIG_ID),
  }));
}

export function configRouteMatches(pattern: string, target: string) {
  const patternParts = pattern.split(':');
  const targetParts = target.split(':');
  return (
    patternParts.length === 3 &&
    targetParts.length === 3 &&
    patternParts.every((part, index) => !part || part === '*' || part === targetParts[index])
  );
}

export function resolveChatConfigId(entries: ConfigRouteEntry[], umo: string) {
  return entries.find((entry) => configRouteMatches(entry.pattern, umo))?.configId || DEFAULT_CONFIG_ID;
}
