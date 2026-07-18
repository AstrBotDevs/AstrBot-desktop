import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseConfigProfile, parseProviderSchema } from '@/api/domain';
import { getConfigProfile, getProviderSchema, getSystemConfig, updateConfigProfileContent } from '@/api/openapi';
import { decodeApiData, expectRecord, isRecord } from '@/api/response';
import { Markdown } from '@/components/content/Markdown';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { toast } from '@/stores/feedback';
import PlatformPage from '@/routes/configuration/PlatformPage';
import ProviderPage from '@/routes/configuration/ProviderPage';
import {
  greetingPeriod,
  hasChatProvider,
  isComputerAccessRuntimeConfigured,
  normalizeComputerAccessRuntime,
  pickDefaultProviderId,
  resolveWelcomeAnnouncement,
  type ComputerAccessRuntime,
} from './welcomeModel';

export default function WelcomePage() {
  const { i18n, t } = useTranslation();
  const [hasPlatform, setHasPlatform] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [runtime, setRuntime] = useState<ComputerAccessRuntime>('none');
  const [hasConfiguredRuntime, setHasConfiguredRuntime] = useState(false);
  const [savingRuntime, setSavingRuntime] = useState(false);
  const [announcementRaw, setAnnouncementRaw] = useState<unknown>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const announcement = useMemo(() => resolveWelcomeAnnouncement(announcementRaw, i18n.language), [announcementRaw, i18n.language]);
  const prefix = 'features.welcome';

  const refreshOnboarding = useCallback(async () => {
    await Promise.allSettled([getSystemConfig(), getProviderSchema(), getConfigProfile({ path: { config_id: 'default' } })])
      .then(([system, providers, profile]) => {
        if (system.status === 'fulfilled') {
          const data = decodeApiData(system.value, (value) => expectRecord(value, 'system config'), 'system config');
          const config = isRecord(data.config) ? data.config : data;
          const platforms = config.platform;
          setHasPlatform(Array.isArray(platforms) && platforms.length > 0);
        }
        const providerPayload = providers.status === 'fulfilled'
          ? decodeApiData(providers.value, parseProviderSchema, 'provider schema')
          : undefined;
        if (providerPayload) setHasProvider(hasChatProvider(providerPayload));
        if (profile.status === 'fulfilled') {
          const profileData = decodeApiData(profile.value, parseConfigProfile, 'default config profile');
          const data = isRecord(profileData.config) ? profileData.config : profileData;
          const settings = isRecord(data.provider_settings) ? data.provider_settings : {};
          const configuredRuntime = settings?.computer_use_runtime;
          setRuntime(normalizeComputerAccessRuntime(configuredRuntime));
          setHasConfiguredRuntime(isComputerAccessRuntimeConfigured(configuredRuntime));
          const providerId = pickDefaultProviderId(providerPayload);
          if (providerId && settings?.default_provider_id !== providerId) {
            const providerSettings = { ...settings, default_provider_id: providerId };
            void updateConfigProfileContent({ body: { ...data, provider_settings: providerSettings }, path: { config_id: 'default' } })
              .then(() => toast.success(t(`${prefix}.onboard.providerDefaultUpdated`, { id: providerId })))
              .catch((cause) => toast.error(cause instanceof Error ? cause.message : t(`${prefix}.onboard.providerUpdateFailed`)));
          }
        }
      });
  }, [t]);

  useEffect(() => {
    let active = true;
    void refreshOnboarding();
    void fetch('https://cloud.astrbot.app/api/v1/announcement')
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => active && setAnnouncementRaw(payload?.data?.notice?.welcome_page ?? null))
      .catch(() => undefined);
    return () => { active = false; };
  }, [refreshOnboarding]);

  const saveRuntime = async (next: ComputerAccessRuntime) => {
    const previous = runtime;
    const wasConfigured = hasConfiguredRuntime;
    setRuntime(next);
    setSavingRuntime(true);
    try {
      const response = await getConfigProfile({ path: { config_id: 'default' } });
      const wrapper = decodeApiData(response, parseConfigProfile, 'default config profile');
      const config = isRecord(wrapper.config) ? wrapper.config : wrapper;
      const providerSettings = {
        ...(isRecord(config.provider_settings) ? config.provider_settings : {}),
        computer_use_runtime: next,
      };
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
              <button className="button--primary" onClick={() => setProviderOpen(true)} type="button">{t(`${prefix}.onboard.configure`)}</button>
              {hasProvider && <span className="onboarding-complete">{t(`${prefix}.onboard.completed`)}</span>}
            </div>
          </li>
          <li className={hasPlatform ? 'is-complete' : ''}>
            <span className="onboarding-list__marker"><MdiIcon name="mdi-numeric-2" /></span>
            <div className="onboarding-list__content"><h3>{t(`${prefix}.onboard.step2Title`)}</h3><p>{t(`${prefix}.onboard.step2Desc`)}</p>
              <button className="button--primary" onClick={() => setPlatformOpen(true)} type="button">{t(`${prefix}.onboard.configure`)}</button>
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
      <Dialog onOpenChange={(open) => { setProviderOpen(open); if (!open) void refreshOnboarding(); }} open={providerOpen} title={t(`${prefix}.onboard.step1Title`)}><div className="welcome-onboarding-dialog"><ProviderPage /></div></Dialog>
      <Dialog onOpenChange={(open) => { setPlatformOpen(open); if (!open) void refreshOnboarding(); }} open={platformOpen} title={t(`${prefix}.onboard.step2Title`)}><div className="welcome-onboarding-dialog"><PlatformPage /></div></Dialog>
    </div>
  );
}
