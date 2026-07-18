import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { defaultLocale, isSupportedLocale, supportedLocales } from './locales';
import { translations } from './translations';

const LOCALE_STORAGE_KEY = 'astrbot-locale';
const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
const initialLocale = storedLocale && isSupportedLocale(storedLocale) ? storedLocale : defaultLocale;

const resources = Object.fromEntries(
  Object.entries(translations).map(([locale, translation]) => [locale, { translation }]),
);

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  fallbackLng: defaultLocale,
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
  lng: initialLocale,
  resources,
  supportedLngs: supportedLocales,
});

i18n.on('languageChanged', (locale) => {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  window.dispatchEvent(
    new CustomEvent('astrbot-locale-changed', {
      detail: { locale },
    }),
  );
});
