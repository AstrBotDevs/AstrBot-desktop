import { describe, expect, it } from 'vitest';

import {
  buildPluginNavigation,
  defaultNavigationItems,
  filterMainNavigationItems,
  mergePluginNavigation,
  MORE_GROUP_KEY,
  navigationItemActive,
  resolveNavigationItems,
} from './navigation';

describe('sidebar navigation compatibility', () => {
  it('keeps the legacy default order without customization', () => {
    expect(resolveNavigationItems(defaultNavigationItems, null)).toBe(defaultNavigationItems);
  });

  it('uses the same MDI icon names as the legacy sidebar', () => {
    const items = defaultNavigationItems.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(items.every((item) => item.icon.startsWith('mdi-'))).toBe(true);
    expect(defaultNavigationItems.find((item) => item.to === '/welcome')?.icon).toBe('mdi-hand-wave-outline');
    expect(defaultNavigationItems.find((item) => item.to === '/platforms')?.icon).toBe('mdi-robot');
  });

  it('keeps plugin management as a single sidebar entry', () => {
    const extension = defaultNavigationItems.find((item) => item.title === 'core.navigation.extension');
    expect(extension?.to).toBe('/extension#installed');
    expect(extension?.children).toBeUndefined();
  });

  it('keeps the platform log entry out of the sidebar', () => {
    const items = defaultNavigationItems.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(items.some((item) => item.to === '/console')).toBe(false);
  });

  it('keeps configuration profiles inside settings instead of the main sidebar', () => {
    const items = defaultNavigationItems.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(items.some((item) => item.to === '/config')).toBe(false);
  });

  it('removes legacy configuration entries from restored and nested navigation', () => {
    const result = filterMainNavigationItems([
      { title: 'core.navigation.config', icon: 'mdi-cog', to: '/config' },
      {
        title: MORE_GROUP_KEY,
        icon: 'mdi-dots-horizontal',
        children: [
          { title: 'legacy-config', icon: 'mdi-cog', to: '/config#platform_group' },
          { title: 'core.navigation.trace', icon: 'mdi-timeline-text-outline', to: '/trace' },
        ],
      },
    ]);

    expect(
      result.flatMap((item) => [item, ...(item.children ?? [])]).some((item) => item.to?.startsWith('/config')),
    ).toBe(false);
    expect(result[0].children?.map((item) => item.to)).toEqual(['/trace']);
  });

  it('applies existing sidebar customization and keeps new defaults', () => {
    const result = resolveNavigationItems(defaultNavigationItems, {
      mainItems: ['core.navigation.cron', 'missing', 'core.navigation.cron'],
      moreItems: ['core.navigation.welcome', 'core.navigation.trace'],
    });

    expect(result[0].title).toBe('core.navigation.cron');
    const more = result.find((item) => item.title === MORE_GROUP_KEY);
    expect(more?.children?.map((item) => item.title)).toContain('core.navigation.trace');
    expect(result.some((item) => item.title === 'core.navigation.platforms')).toBe(true);
  });

  it('builds the legacy plugin WebUI group from active plugins with pages', () => {
    const group = buildPluginNavigation([
      { name: 'demo plugin', display_name: 'Demo', activated: true, pages: ['settings'] },
      { name: 'disabled', activated: false, pages: ['index'] },
      { name: 'no-pages', activated: true, pages: [] },
    ]);
    expect(group?.children).toEqual([
      expect.objectContaining({
        title: 'Demo',
        to: '/plugin-page/demo%20plugin/settings',
      }),
    ]);
    const merged = mergePluginNavigation(defaultNavigationItems, group);
    expect(merged.findIndex((item) => item === group)).toBe(
      merged.findIndex((item) => item.title === MORE_GROUP_KEY) - 1,
    );
  });

  it('marks and expands a parent group for deep-linked children', () => {
    const more = defaultNavigationItems.find((item) => item.title === MORE_GROUP_KEY)!;
    expect(navigationItemActive(more, '/trace', '')).toBe(true);
    expect(navigationItemActive(more, '/settings', '')).toBe(false);
  });
});
