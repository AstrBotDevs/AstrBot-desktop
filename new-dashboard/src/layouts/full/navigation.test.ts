import { describe, expect, it } from 'vitest';

import {
  defaultNavigationItems,
  MORE_GROUP_KEY,
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

  it('applies existing sidebar customization and keeps new defaults', () => {
    const result = resolveNavigationItems(defaultNavigationItems, {
      mainItems: ['core.navigation.console', 'missing', 'core.navigation.console'],
      moreItems: ['core.navigation.welcome', 'core.navigation.trace'],
    });

    expect(result[0].title).toBe('core.navigation.console');
    const more = result.find((item) => item.title === MORE_GROUP_KEY);
    expect(more?.children?.map((item) => item.title)).toContain('core.navigation.trace');
    expect(result.some((item) => item.title === 'core.navigation.platforms')).toBe(true);
  });
});
