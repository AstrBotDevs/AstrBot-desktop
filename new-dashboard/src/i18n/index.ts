import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { translations } from '@legacy-i18n/translations';

const LOCALE_STORAGE_KEY = 'astrbot-locale';
const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
const initialLocale = storedLocale === 'en-US' || storedLocale === 'ru-RU'
  ? storedLocale
  : 'zh-CN';

const resources = Object.fromEntries(
  Object.entries(translations).map(([locale, translation]) => [
    locale,
    { translation },
  ]),
);

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
  lng: initialLocale,
  resources,
  supportedLngs: ['zh-CN', 'en-US', 'ru-RU'],
});

i18n.on('languageChanged', (locale) => {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  window.dispatchEvent(new CustomEvent('astrbot-locale-changed', {
    detail: { locale },
  }));
});
