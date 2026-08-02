import { describe, expect, it } from 'vitest';

import { isExtensionCapabilityTab, resolveCapabilityTab } from './capabilityCenterModel';

describe('capability center navigation', () => {
  it.each([
    ['#installed', 'installed'],
    ['#market', 'market'],
    ['#components', 'components'],
    ['#mcp', 'mcp'],
    ['#skills', 'skills'],
    ['#knowledge-base', 'knowledge-base'],
    ['#persona', 'persona'],
    ['#subagent', 'subagent'],
    ['#cron', 'cron'],
  ])('resolves %s to %s', (hash, expected) => {
    expect(resolveCapabilityTab(hash)).toBe(expected);
  });

  it('uses installed plugins for missing and unknown tabs', () => {
    expect(resolveCapabilityTab('')).toBe('installed');
    expect(resolveCapabilityTab('#unknown')).toBe('installed');
  });

  it('identifies tabs backed by the extension page', () => {
    expect(isExtensionCapabilityTab('installed')).toBe(true);
    expect(isExtensionCapabilityTab('skills')).toBe(true);
    expect(isExtensionCapabilityTab('knowledge-base')).toBe(false);
  });
});
