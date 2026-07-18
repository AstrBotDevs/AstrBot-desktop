import i18next from 'i18next';

export const testI18n = i18next.createInstance();

void testI18n.init({
  fallbackLng: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  lng: 'en-US',
  resources: {},
});
