import { sidebarCustomizationPreference } from '@/config/preferences';

export type NavigationItem = {
  children?: NavigationItem[];
  icon: `mdi-${string}`;
  title: string;
  to?: string;
};

export const PLUGIN_WEBUI_GROUP_KEY = 'core.navigation.pluginWebui';
export const PLUGIN_SIDEBAR_CHANGED_EVENT = 'astrbot:plugin-sidebar-changed';

const REMOVED_MAIN_NAVIGATION_TITLES = new Set(['core.navigation.config', 'core.navigation.extension']);
const REMOVED_MAIN_NAVIGATION_PATHS = new Set(['/config', '/extension', '/extension-marketplace']);

const secondaryItems: NavigationItem[] = [
  { title: 'core.navigation.conversation', icon: 'mdi-database', to: '/conversation' },
  { title: 'core.navigation.sessionManagement', icon: 'mdi-pencil-ruler', to: '/session-management' },
  { title: 'core.navigation.dashboard', icon: 'mdi-view-dashboard', to: '/dashboard/default' },
  { title: 'core.navigation.trace', icon: 'mdi-timeline-text-outline', to: '/trace' },
];

export const defaultNavigationItems: NavigationItem[] = [
  { title: 'core.navigation.welcome', icon: 'mdi-hand-wave-outline', to: '/welcome' },
  { title: 'core.navigation.platforms', icon: 'mdi-robot', to: '/platforms' },
  { title: 'core.navigation.providers', icon: 'mdi-creation', to: '/providers' },
  { title: 'core.navigation.capabilityCenter', icon: 'mdi-puzzle', to: '/capabilities' },
  ...secondaryItems,
];

type PluginNavigationRecord = {
  activated?: unknown;
  display_name?: unknown;
  enabled?: unknown;
  id?: unknown;
  name?: unknown;
  pages?: unknown;
};

export function buildPluginNavigation(items: unknown[]): NavigationItem | null {
  const children = items.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as PluginNavigationRecord;
    if (!(item.activated ?? item.enabled)) return [];
    const pluginName = String(item.name || item.id || '').trim();
    const pages = Array.isArray(item.pages) ? item.pages : [];
    const firstPage = pages
      .map((page) => {
        if (page && typeof page === 'object') {
          const record = page as { id?: unknown; name?: unknown; page_name?: unknown };
          return String(record.name || record.page_name || record.id || '').trim();
        }
        return String(page || '').trim();
      })
      .find(Boolean);
    if (!pluginName || !firstPage) return [];
    return [
      {
        title: String(item.display_name || pluginName),
        icon: 'mdi-puzzle' as const,
        to: `/plugin-page/${encodeURIComponent(pluginName)}/${encodeURIComponent(firstPage)}`,
      },
    ];
  });
  return children.length
    ? {
        title: PLUGIN_WEBUI_GROUP_KEY,
        icon: 'mdi-puzzle-outline',
        children,
      }
    : null;
}

export function mergePluginNavigation(items: NavigationItem[], pluginItem: NavigationItem | null) {
  const visibleItems = filterMainNavigationItems(items);
  if (!pluginItem) return visibleItems;
  const visiblePluginItems = filterMainNavigationItems([pluginItem]);
  if (!visiblePluginItems.length) return visibleItems;
  const visiblePluginItem = visiblePluginItems[0];
  const secondaryIndex = visibleItems.findIndex((item) => item.title === secondaryItems[0]?.title);
  if (secondaryIndex < 0) return [...visibleItems, visiblePluginItem];
  return [...visibleItems.slice(0, secondaryIndex), visiblePluginItem, ...visibleItems.slice(secondaryIndex)];
}

export function filterMainNavigationItems(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => {
    const path = item.to?.split('#')[0];
    if (REMOVED_MAIN_NAVIGATION_TITLES.has(item.title) || (path && REMOVED_MAIN_NAVIGATION_PATHS.has(path))) {
      return [];
    }
    if (!item.children) return [item];
    const children = filterMainNavigationItems(item.children);
    if (
      children.length === item.children.length &&
      children.every((child, index) => child === item.children?.[index])
    ) {
      return [item];
    }
    return [{ ...item, children }];
  });
}

export function navigationTargetActive(to: string | undefined, pathname: string, hash: string) {
  if (!to) return false;
  const [targetPath, targetHash] = to.split('#');
  return pathname === targetPath && (targetHash == null || hash === `#${targetHash}`);
}

export function navigationItemActive(item: NavigationItem, pathname: string, hash: string): boolean {
  return (
    navigationTargetActive(item.to, pathname, hash) ||
    Boolean(item.children?.some((child) => navigationItemActive(child, pathname, hash)))
  );
}

type SidebarCustomization = { mainItems?: unknown; moreItems?: unknown };

function stringKeys(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : [];
}

export function resolveNavigationItems(items: NavigationItem[], customization: SidebarCustomization | null) {
  if (!customization) return items;
  const allItems = new Map(items.map((item) => [item.title, item]));
  const preferredKeys = stringKeys(customization.mainItems)
    .concat(stringKeys(customization.moreItems))
    .filter((key, index, keys) => allItems.has(key) && keys.indexOf(key) === index);
  const used = new Set(preferredKeys);
  return preferredKeys.map((key) => allItems.get(key)!).concat(items.filter((item) => !used.has(item.title)));
}

export function readNavigationItems() {
  return filterMainNavigationItems(
    resolveNavigationItems(defaultNavigationItems, sidebarCustomizationPreference.read()),
  );
}
