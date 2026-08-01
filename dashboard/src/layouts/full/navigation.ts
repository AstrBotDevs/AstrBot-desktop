import { sidebarCustomizationPreference } from '@/config/preferences';

export type NavigationItem = {
  children?: NavigationItem[];
  icon: `mdi-${string}`;
  title: string;
  to?: string;
};

export const MORE_GROUP_KEY = 'core.navigation.groups.more';
export const PLUGIN_WEBUI_GROUP_KEY = 'core.navigation.pluginWebui';
export const PLUGIN_SIDEBAR_CHANGED_EVENT = 'astrbot:plugin-sidebar-changed';

const REMOVED_MAIN_NAVIGATION_TITLES = new Set(['core.navigation.config']);
const REMOVED_MAIN_NAVIGATION_PATHS = new Set(['/config']);

const moreItems: NavigationItem[] = [
  { title: 'core.navigation.conversation', icon: 'mdi-database', to: '/conversation' },
  { title: 'core.navigation.sessionManagement', icon: 'mdi-pencil-ruler', to: '/session-management' },
  { title: 'core.navigation.cron', icon: 'mdi-clock-outline', to: '/cron' },
  { title: 'core.navigation.subagent', icon: 'mdi-vector-link', to: '/subagent' },
  { title: 'core.navigation.dashboard', icon: 'mdi-view-dashboard', to: '/dashboard/default' },
  { title: 'core.navigation.trace', icon: 'mdi-timeline-text-outline', to: '/trace' },
];

export const defaultNavigationItems: NavigationItem[] = [
  { title: 'core.navigation.welcome', icon: 'mdi-hand-wave-outline', to: '/welcome' },
  { title: 'core.navigation.platforms', icon: 'mdi-robot', to: '/platforms' },
  { title: 'core.navigation.providers', icon: 'mdi-creation', to: '/providers' },
  { title: 'core.navigation.extension', icon: 'mdi-puzzle', to: '/extension#installed' },
  { title: 'core.navigation.knowledgeBase', icon: 'mdi-book-open-variant', to: '/knowledge-base' },
  { title: 'core.navigation.persona', icon: 'mdi-heart', to: '/persona' },
  { title: MORE_GROUP_KEY, icon: 'mdi-dots-horizontal', children: moreItems },
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
  const moreIndex = visibleItems.findIndex((item) => item.title === MORE_GROUP_KEY);
  if (moreIndex < 0) return [...visibleItems, visiblePluginItem];
  return [...visibleItems.slice(0, moreIndex), visiblePluginItem, ...visibleItems.slice(moreIndex)];
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
  const moreGroup = items.find((item) => item.title === MORE_GROUP_KEY);
  const allItems = new Map<string, NavigationItem>();
  items.filter((item) => item.title !== MORE_GROUP_KEY).forEach((item) => allItems.set(item.title, item));
  moreGroup?.children?.forEach((item) => allItems.set(item.title, item));
  const mainKeys = stringKeys(customization.mainItems).filter((key) => allItems.has(key));
  const mainSet = new Set(mainKeys);
  const moreKeys = stringKeys(customization.moreItems).filter((key) => allItems.has(key) && !mainSet.has(key));
  const used = new Set([...mainKeys, ...moreKeys]);
  const defaultMain = items.filter((item) => item.title !== MORE_GROUP_KEY);
  const defaultMore = moreGroup?.children ?? [];
  const main = mainKeys.map((key) => allItems.get(key)!).concat(defaultMain.filter((item) => !used.has(item.title)));
  const more = moreKeys.map((key) => allItems.get(key)!).concat(defaultMore.filter((item) => !used.has(item.title)));
  const resolvedMoreGroup: NavigationItem = {
    title: MORE_GROUP_KEY,
    icon: 'mdi-dots-horizontal',
    children: more,
  };
  return more.length ? [...main, resolvedMoreGroup] : main;
}

export function readNavigationItems() {
  return filterMainNavigationItems(
    resolveNavigationItems(defaultNavigationItems, sidebarCustomizationPreference.read()),
  );
}
