import { defaultLocale, isSupportedLocale } from './locales';
import { DEFAULT_CONFIG_ID } from './defaults';
import { definePersistentValue, parseBoolean, parseString, parseStringArray } from './persistence';
import { storageKeys } from './storageKeys';

export const localePreference = definePersistentValue({
  fallback: defaultLocale,
  key: storageKeys.locale,
  parse: (value) => (typeof value === 'string' && isSupportedLocale(value) ? value : undefined),
});

export const themePrimaryPreference = definePersistentValue({
  fallback: '',
  key: storageKeys.theme.primary,
  parse: parseString,
});

export const themeSecondaryPreference = definePersistentValue({
  fallback: '',
  key: storageKeys.theme.secondary,
  parse: parseString,
});

export const openedSidebarGroupsPreference = definePersistentValue({
  fallback: [] as string[],
  key: storageKeys.layout.openedSidebarGroups,
  parse: parseStringArray,
});

export const expandedChatProjectsPreference = definePersistentValue({
  fallback: [] as string[],
  key: storageKeys.chat.expandedProjectIds,
  parse: parseStringArray,
});

export const selectedProviderPreference = definePersistentValue({
  fallback: '',
  key: storageKeys.chat.selectedProvider,
  parse: parseString,
});

export const selectedModelPreference = definePersistentValue({
  fallback: '',
  key: storageKeys.chat.selectedModel,
  parse: parseString,
});

export const chatTransportPreference = definePersistentValue({
  fallback: 'sse' as 'sse' | 'websocket',
  key: storageKeys.chat.transportMode,
  parse: (value) => (value === 'sse' || value === 'websocket' ? value : undefined),
});

export const consoleAutoScrollPreference = definePersistentValue({
  fallback: true,
  key: storageKeys.console.autoScroll,
  parse: parseBoolean,
});

export const selectedPluginSourcePreference = definePersistentValue({
  fallback: '',
  key: storageKeys.extensions.selectedSource,
  parse: parseString,
});

export const pinnedPluginsPreference = definePersistentValue({
  fallback: [] as string[],
  key: storageKeys.extensions.pinned,
  parse: parseStringArray,
});

export const selectedConfigPreference = definePersistentValue({
  fallback: DEFAULT_CONFIG_ID,
  key: storageKeys.chat.selectedConfigId,
  parse: parseString,
});

export const firstNoticeSeenPreference = definePersistentValue({
  fallback: false,
  key: storageKeys.notice.firstSeen,
  parse: parseBoolean,
});

export const githubProxyEnabledPreference = definePersistentValue({
  fallback: false,
  key: storageKeys.githubProxy.enabled,
  parse: parseBoolean,
});

export const githubProxyControlPreference = definePersistentValue({
  fallback: '0',
  key: storageKeys.githubProxy.control,
  parse: parseString,
});

export const selectedGithubProxyPreference = definePersistentValue({
  fallback: '',
  key: storageKeys.githubProxy.selected,
  parse: parseString,
});

export type SidebarCustomizationPreference = {
  mainItems?: string[];
  moreItems?: string[];
};

export const sidebarCustomizationPreference = definePersistentValue<SidebarCustomizationPreference | null>({
  fallback: null,
  key: storageKeys.layout.sidebarCustomization,
  parse: (value) => {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const mainItems = parseStringArray(record.mainItems);
    const moreItems = parseStringArray(record.moreItems);
    if (!mainItems || !moreItems) return undefined;
    return { mainItems, moreItems };
  },
});

export const themeModePreference = definePersistentValue({
  fallback: 'system' as 'dark' | 'light' | 'system',
  key: storageKeys.layout.themeMode,
  parse: (value) => (value === 'dark' || value === 'light' || value === 'system' ? value : undefined),
});

export const legacyThemePreference = definePersistentValue({
  fallback: '',
  key: storageKeys.layout.legacyTheme,
  parse: (value) => (value === 'PurpleTheme' || value === 'PurpleThemeDark' ? value : undefined),
});
