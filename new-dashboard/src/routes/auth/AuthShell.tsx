import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLayoutStore, type ThemeMode } from '@/stores/layout';

const languages = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
  { code: 'ru-RU', label: 'Русский' },
];

export function AuthShell({ children, subtitle, title }: { children: ReactNode; subtitle: string; title: string }) {
  const { i18n, t } = useTranslation();
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <header className="auth-card__header">
          <img alt="AstrBot" height="64" src="/favicon.svg" width="64" />
          <div className="auth-card__controls">
            <label>
              <span className="sr-only">{t('core.common.language', 'Language')}</span>
              <select
                aria-label={t('core.common.language', 'Language')}
                onChange={(event) => void i18n.changeLanguage(event.target.value)}
                value={i18n.language}
              >
                {languages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">{t('features.auth.theme.title')}</span>
              <select
                aria-label={t('features.auth.theme.title')}
                onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
                value={themeMode}
              >
                <option value="light">{t('features.auth.theme.light')}</option>
                <option value="dark">{t('features.auth.theme.dark')}</option>
                <option value="system">{t('features.auth.theme.system')}</option>
              </select>
            </label>
          </div>
        </header>
        <h1>{title}</h1>
        <p className="auth-card__subtitle">{subtitle}</p>
        {children}
      </section>
    </main>
  );
}
