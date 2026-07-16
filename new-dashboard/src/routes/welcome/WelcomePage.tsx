import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { getConfigProfile, getProviderSchema, getSystemConfig, updateConfigProfileContent } from '@/api/openapi';
import { Markdown } from '@/components/content/Markdown';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { toast } from '@/stores/feedback';
import {
  greetingPeriod,
  hasChatProvider,
  isComputerAccessRuntimeConfigured,
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
  const [hasConfiguredRuntime, setHasConfiguredRuntime] = useState(false);
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
          const configuredRuntime = settings?.computer_use_runtime;
          setRuntime(normalizeComputerAccessRuntime(configuredRuntime));
          setHasConfiguredRuntime(isComputerAccessRuntimeConfigured(configuredRuntime));
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
    const wasConfigured = hasConfiguredRuntime;
    setRuntime(next);
    setSavingRuntime(true);
    try {
      const response = await getConfigProfile({ path: { config_id: 'default' } });
      const wrapper = unwrapApiData<ConfigPayload>(response);
      const config = (wrapper?.config ?? wrapper ?? {}) as Record<string, unknown>;
      const providerSettings = { ...(config.provider_settings as Record<string, unknown> | undefined), computer_use_runtime: next };
      await updateConfigProfileContent({ body: { ...config, provider_settings: providerSettings }, path: { config_id: 'default' } });
      setHasConfiguredRuntime(true);
      toast.success(t(`${prefix}.onboard.${next === 'local' ? 'computerAccessAllowed' : 'computerAccessDenied'}`));
    } catch (cause) {
      setRuntime(previous);
      setHasConfiguredRuntime(wasConfigured);
      toast.error(cause instanceof Error ? cause.message : t(`${prefix}.onboard.computerAccessUpdateFailed`));
    } finally {
      setSavingRuntime(false);
    }
  };

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
            <span className="onboarding-list__marker"><MdiIcon name="mdi-numeric-1" /></span>
            <div className="onboarding-list__content"><h3>{t(`${prefix}.onboard.step1Title`)}</h3><p>{t(`${prefix}.onboard.step1Desc`)}</p>
              <Link className="button--primary" to="/providers">{t(`${prefix}.onboard.configure`)}</Link>
              {hasProvider && <span className="onboarding-complete">{t(`${prefix}.onboard.completed`)}</span>}
            </div>
          </li>
          <li className={hasPlatform ? 'is-complete' : ''}>
            <span className="onboarding-list__marker"><MdiIcon name="mdi-numeric-2" /></span>
            <div className="onboarding-list__content"><h3>{t(`${prefix}.onboard.step2Title`)}</h3><p>{t(`${prefix}.onboard.step2Desc`)}</p>
              <Link className="button--primary" to="/platforms">{t(`${prefix}.onboard.configure`)}</Link>
              {hasPlatform && <span className="onboarding-complete">{t(`${prefix}.onboard.completed`)}</span>}
            </div>
          </li>
          <li className={hasConfiguredRuntime ? 'is-complete' : ''}>
            <span className="onboarding-list__marker"><MdiIcon name="mdi-numeric-3" /></span>
            <div className="onboarding-list__content"><h3>{t(`${prefix}.onboard.step3Title`)}</h3><p>{t(`${prefix}.onboard.step3Desc`)}</p>
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
            </div>
          </li>
        </ol>
      </section>
      {announcement && <section className="route-card"><h2>{t(`${prefix}.announcement.title`)}</h2><Markdown content={announcement} /></section>}
    </div>
  );
}
