export const localeRegistry = [
  { code: 'zh-CN', flag: 'CN', label: '简体中文' },
  { code: 'en-US', flag: 'US', label: 'English' },
  { code: 'ru-RU', flag: 'RU', label: 'Русский' },
] as const;

export type SupportedLocale = (typeof localeRegistry)[number]['code'];

export const defaultLocale: SupportedLocale = 'zh-CN';
export const supportedLocales = localeRegistry.map(({ code }) => code);

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return supportedLocales.some((supported) => supported === locale);
}

export function localeMetadata(locale: string) {
  return localeRegistry.find(({ code }) => code === locale) ?? localeRegistry[0];
}
