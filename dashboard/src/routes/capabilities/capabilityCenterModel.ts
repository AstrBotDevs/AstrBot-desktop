export type CapabilityTab =
  'installed' | 'market' | 'components' | 'mcp' | 'skills' | 'knowledge-base' | 'persona' | 'subagent' | 'cron';

const extensionTabs = new Set<CapabilityTab>(['installed', 'market', 'components', 'mcp', 'skills']);
const capabilityTabs = new Set<CapabilityTab>([...extensionTabs, 'knowledge-base', 'persona', 'subagent', 'cron']);

export function isExtensionCapabilityTab(tab: CapabilityTab) {
  return extensionTabs.has(tab);
}

export function resolveCapabilityTab(hash: string): CapabilityTab {
  const requested = hash.replace(/^#/, '') as CapabilityTab;
  return capabilityTabs.has(requested) ? requested : 'installed';
}
