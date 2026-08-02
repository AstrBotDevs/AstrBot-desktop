import { describe, expect, it } from 'vitest';

import {
  buildPluginNavigation,
  defaultNavigationItems,
  filterMainNavigationItems,
  mergePluginNavigation,
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

  it('keeps plugin management inside the capability center', () => {
    expect(defaultNavigationItems.some((item) => item.to?.startsWith('/extension'))).toBe(false);
    expect(defaultNavigationItems.find((item) => item.to === '/capabilities')).toBeDefined();
  });

  it('keeps the platform log entry out of the sidebar', () => {
    const items = defaultNavigationItems.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(items.some((item) => item.to === '/console')).toBe(false);
  });

  it('keeps configuration profiles inside settings instead of the main sidebar', () => {
    const items = defaultNavigationItems.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(items.some((item) => item.to === '/config')).toBe(false);
  });

  it('groups agent capabilities behind a single capability center entry', () => {
    const items = defaultNavigationItems.flatMap((item) => [item, ...(item.children ?? [])]);
    expect(defaultNavigationItems.find((item) => item.to === '/capabilities')).toEqual(
      expect.objectContaining({ title: 'core.navigation.capabilityCenter', icon: 'mdi-puzzle' }),
    );
    expect(
      items.some((item) => ['/extension', '/knowledge-base', '/persona', '/subagent', '/cron'].includes(item.to ?? '')),
    ).toBe(false);
  });

  it('shows former more-feature entries directly in the sidebar', () => {
    expect(defaultNavigationItems.map((item) => item.to)).toEqual([
      '/welcome',
      '/platforms',
      '/providers',
      '/capabilities',
      '/conversation',
      '/session-management',
      '/dashboard/default',
      '/trace',
    ]);
    expect(defaultNavigationItems.every((item) => item.children == null)).toBe(true);
  });

  it('removes legacy configuration entries from restored and nested navigation', () => {
    const result = filterMainNavigationItems([
      { title: 'core.navigation.config', icon: 'mdi-cog', to: '/config' },
      {
        title: 'plugin-pages',
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

  it('removes legacy extension entries after merging restored navigation', () => {
    const result = filterMainNavigationItems([
      { title: 'core.navigation.extension', icon: 'mdi-puzzle', to: '/extension#installed' },
      { title: 'legacy-market', icon: 'mdi-store', to: '/extension-marketplace' },
      { title: 'core.navigation.capabilityCenter', icon: 'mdi-puzzle', to: '/capabilities' },
    ]);

    expect(result).toEqual([{ title: 'core.navigation.capabilityCenter', icon: 'mdi-puzzle', to: '/capabilities' }]);
  });

  it('applies existing sidebar customization and keeps new defaults', () => {
    const result = resolveNavigationItems(defaultNavigationItems, {
      mainItems: ['core.navigation.trace', 'missing', 'core.navigation.trace'],
      moreItems: ['core.navigation.welcome', 'core.navigation.dashboard'],
    });

    expect(result[0].title).toBe('core.navigation.trace');
    expect(result.map((item) => item.title)).toEqual([
      'core.navigation.trace',
      'core.navigation.welcome',
      'core.navigation.dashboard',
      'core.navigation.platforms',
      'core.navigation.providers',
      'core.navigation.capabilityCenter',
      'core.navigation.conversation',
      'core.navigation.sessionManagement',
    ]);
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
      merged.findIndex((item) => item.to === '/conversation') - 1,
    );
  });

  it('marks direct entries as active', () => {
    const trace = defaultNavigationItems.find((item) => item.to === '/trace')!;
    expect(navigationItemActive(trace, '/trace', '')).toBe(true);
    expect(navigationItemActive(trace, '/settings', '')).toBe(false);
  });
});
