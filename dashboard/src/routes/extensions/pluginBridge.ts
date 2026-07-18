export const PLUGIN_PAGE_CHANNEL = 'astrbot-plugin-page';

export function isTrustedPluginMessageOrigin(
  origin: string,
  expectedOrigin = window.location.origin,
  lockedOrigin?: string | null,
) {
  if (origin !== expectedOrigin && origin !== 'null') return false;
  return !lockedOrigin || lockedOrigin === origin;
}

export function pluginMessageTargetOrigin(lockedOrigin?: string | null) {
  return lockedOrigin && lockedOrigin !== 'null' ? lockedOrigin : '*';
}
