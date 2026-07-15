import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { getConfigProfile, getProviderSchema, getSystemConfig, updateConfigProfileContent } from '@/api/openapi';
import { Markdown } from '@/components/content/Markdown';
import { toast } from '@/stores/feedback';
import {
  greetingPeriod,
  hasChatProvider,
  normalizeComputerAccessRuntime,
  resolveWelcomeAnnouncement,
  unwrapApiData,
  type ComputerAccessRuntime,
} from './welcomeModel';

type ConfigPayload = { config?: Record<string, unknown> };

export default function WelcomePage() {
  const { i18n, t } = useTranslation();
  const [hasPlatform, setHasPlatform] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [runtime, setRuntime] = useState<ComputerAccessRuntime>('none');
  const [savingRuntime, setSavingRuntime] = useState(false);
  const [announcementRaw, setAnnouncementRaw] = useState<unknown>(null);
  const announcement = useMemo(() => resolveWelcomeAnnouncement(announcementRaw, i18n.language), [announcementRaw, i18n.language]);
  const prefix = 'features.welcome';

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getSystemConfig(), getProviderSchema(), getConfigProfile({ path: { config_id: 'default' } })])
      .then(([system, providers, profile]) => {
        if (!active) return;
        if (system.status === 'fulfilled') {
          const data = unwrapApiData<ConfigPayload>(system.value);
          const platforms = data?.config?.platform;
          setHasPlatform(Array.isArray(platforms) && platforms.length > 0);
        }
        if (providers.status === 'fulfilled') setHasProvider(hasChatProvider(unwrapApiData(providers.value)));
        if (profile.status === 'fulfilled') {
          const data = unwrapApiData<ConfigPayload>(profile.value)?.config ?? unwrapApiData<Record<string, unknown>>(profile.value) ?? {};
          const settings = data.provider_settings as Record<string, unknown> | undefined;
          setRuntime(normalizeComputerAccessRuntime(settings?.computer_use_runtime));
        }
      });
    void fetch('https://cloud.astrbot.app/api/v1/announcement')
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => active && setAnnouncementRaw(payload?.data?.notice?.welcome_page ?? null))
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const saveRuntime = async (next: ComputerAccessRuntime) => {
    const previous = runtime;
    setRuntime(next);
    setSavingRuntime(true);
    try {
      const response = await getConfigProfile({ path: { config_id: 'default' } });
      const wrapper = unwrapApiData<ConfigPayload>(response);
      const config = (wrapper?.config ?? wrapper ?? {}) as Record<string, unknown>;
      const providerSettings = { ...(config.provider_settings as Record<string, unknown> | undefined), computer_use_runtime: next };
      await updateConfigProfileContent({ body: { ...config, provider_settings: providerSettings }, path: { config_id: 'default' } });
      toast.success(t(`${prefix}.onboard.${next === 'local' ? 'computerAccessAllowed' : 'computerAccessDenied'}`));
    } catch (cause) {
      setRuntime(previous);
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.onboard.computerAccessUpdateFailed`));
    } finally {
      setSavingRuntime(false);
    }
  };

  const resources = [
    { description: t(`${prefix}.resources.githubDesc`), label: 'GitHub', url: 'https://github.com/AstrBotDevs/AstrBot/' },
    { description: t(`${prefix}.resources.docsDesc`), label: t(`${prefix}.resources.docsTitle`), url: 'https://docs.astrbot.app' },
    { description: t(`${prefix}.resources.afdianDesc`), label: t(`${prefix}.resources.afdianTitle`), url: 'https://afdian.com/a/astrbot_team' },
  ];
  return (
    <div className="welcome-page route-page">
      <header className="route-page__heading">
        <h1>{t(`${prefix}.greeting.${greetingPeriod()}`)} 😊</h1>
        <p>{t(`${prefix}.subtitle`)}</p>
      </header>
      <section className="route-card">
        <h2>{t(`${prefix}.onboard.title`)}</h2>
        <ol className="onboarding-list">
          <li className={hasProvider ? 'is-complete' : ''}>
            <h3>{t(`${prefix}.onboard.step1Title`)}</h3><p>{t(`${prefix}.onboard.step1Desc`)}</p>
            <Link className="button--primary" to="/providers">{t(`${prefix}.onboard.configure`)}</Link>
            {hasProvider && <span className="onboarding-complete">✓ {t(`${prefix}.onboard.completed`)}</span>}
          </li>
          <li className={hasPlatform ? 'is-complete' : ''}>
            <h3>{t(`${prefix}.onboard.step2Title`)}</h3><p>{t(`${prefix}.onboard.step2Desc`)}</p>
            <Link className="button--primary" to="/platforms">{t(`${prefix}.onboard.configure`)}</Link>
            {hasPlatform && <span className="onboarding-complete">✓ {t(`${prefix}.onboard.completed`)}</span>}
          </li>
          <li>
            <h3>{t(`${prefix}.onboard.step3Title`)}</h3><p>{t(`${prefix}.onboard.step3Desc`)}</p>
            <select disabled={savingRuntime} onChange={(event) => void saveRuntime(event.target.value as ComputerAccessRuntime)} value={runtime}>
              <option value="local">{t(`${prefix}.onboard.step3Allow`)}</option>
              <option value="none">{t(`${prefix}.onboard.step3Deny`)}</option>
            </select>
            <details className="onboarding-help">
              <summary>{t(`${prefix}.onboard.step3HelpTitle`)}</summary>
              <ol>
                <li>{t(`${prefix}.onboard.step3HelpItem1`)}</li>
                <li>{t(`${prefix}.onboard.step3HelpItem2`)}</li>
                <li>{t(`${prefix}.onboard.step3HelpItem3`)}</li>
              </ol>
            </details>
          </li>
        </ol>
      </section>
      <section className="route-card"><h2>{t(`${prefix}.resources.title`)}</h2><div className="resource-grid">
        {resources.map((resource) => <a href={resource.url} key={resource.url} rel="noreferrer" target="_blank"><strong>{resource.label}</strong><p>{resource.description}</p></a>)}
      </div></section>
      {announcement && <section className="route-card"><h2>{t(`${prefix}.announcement.title`)}</h2><Markdown content={announcement} /></section>}
    </div>
  );
}
