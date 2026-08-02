import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updatesApi } from '@/api/compat';
import { Dialog } from '@/components/headless/Dialog';
import { Menu, MenuItem } from '@/components/headless/Menu';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { useDesktop } from '@/desktop/DesktopProvider';
import { localeMetadata, localeRegistry } from '@/i18n/locales';
import { errorMessage, JsonObject, responseData } from '@/routes/configuration/model';
import { useDesktopStore } from '@/stores/desktop';
import { toast } from '@/stores/feedback';
import { type ThemeMode, useLayoutStore } from '@/stores/layout';
import { headerUpdateRuntime, runHeaderUpdateAction } from './headerModel';

const themeOptions: Array<{ icon: `mdi-${string}`; mode: ThemeMode; labelKey: string }> = [
  { icon: 'mdi-white-balance-sunny', mode: 'light', labelKey: 'core.header.buttons.theme.light' },
  { icon: 'mdi-weather-night', mode: 'dark', labelKey: 'core.header.buttons.theme.dark' },
  { icon: 'mdi-sync', mode: 'system', labelKey: 'core.header.buttons.theme.system' },
];

export function ApplicationMenu() {
  const { i18n, t } = useTranslation();
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.('(max-width: 767px)').matches ?? window.innerWidth < 768,
  );
  const [submenu, setSubmenu] = useState<'language' | 'theme' | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<JsonObject>({});
  const submenuTimer = useRef<number | null>(null);
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);
  const isDesktop = useDesktopStore((state) => state.isDesktop);
  const { checkForUpdate: checkDesktopUpdate, installUpdate: installDesktopUpdate } = useDesktop();

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 767px)');
    if (!media) return;
    const handleChange = (event: MediaQueryListEvent) => setMobile(event.matches);
    setMobile(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(
    () => () => {
      if (submenuTimer.current != null) window.clearTimeout(submenuTimer.current);
    },
    [],
  );

  const currentLanguage = localeMetadata(i18n.language);
  const currentTheme = themeOptions.find((item) => item.mode === themeMode) || themeOptions[0];
  const openSubmenu = (next: 'language' | 'theme') => {
    if (submenuTimer.current != null) window.clearTimeout(submenuTimer.current);
    submenuTimer.current = null;
    setSubmenu(next);
  };
  const scheduleSubmenuClose = () => {
    if (submenuTimer.current != null) window.clearTimeout(submenuTimer.current);
    submenuTimer.current = window.setTimeout(() => {
      setSubmenu(null);
      submenuTimer.current = null;
    }, 120);
  };
  const loadUpdate = async () => {
    setUpdateChecking(true);
    try {
      if (headerUpdateRuntime(isDesktop) === 'desktop') {
        const result = (await runHeaderUpdateAction(
          true,
          checkDesktopUpdate,
          async () => null,
        )) as AstrBotDesktopAppUpdateCheckResult | null;
        if (!result?.ok) throw new Error(result?.reason || t('core.header.updateDialog.desktopApp.checkFailed'));
        setUpdateInfo({
          desktop: true,
          has_new_version: result.hasUpdate,
          latest_version: result.latestVersion || '—',
          version: result.currentVersion || '—',
        });
        return;
      }
      const response = await runHeaderUpdateAction(false, async () => null, updatesApi.check);
      setUpdateInfo(responseData<JsonObject>(response) || {});
    } catch (cause) {
      toast.error(errorMessage(cause, t('core.header.updateDialog.status.checking')));
    } finally {
      setUpdateChecking(false);
    }
  };
  const openUpdate = () => {
    setUpdateOpen(true);
    void loadUpdate();
  };
  const installUpdate = async () => {
    setUpdateInstalling(true);
    try {
      if (headerUpdateRuntime(isDesktop) === 'desktop') {
        const result = (await runHeaderUpdateAction(true, installDesktopUpdate, async () => ({
          ok: false,
        }))) as AstrBotDesktopResult;
        if (!result.ok) throw new Error(result.reason || t('core.header.updateDialog.desktopApp.installFailed'));
      } else {
        await runHeaderUpdateAction(
          false,
          async () => ({ ok: false }),
          () => updatesApi.core({ reboot: true }),
        );
      }
      toast.success(t('core.header.updateDialog.progress.preparing'));
      setUpdateOpen(false);
    } catch (cause) {
      toast.error(errorMessage(cause, t('core.header.updateDialog.progress.failed')));
    } finally {
      setUpdateInstalling(false);
    }
  };

  return (
    <>
      <Menu
        className="application-menu"
        label={t('core.header.buttons.menu')}
        trigger={(props) => (
          <button
            {...props}
            aria-label={t('core.header.buttons.menu')}
            className="application-menu__trigger"
            onClick={() => {
              setSubmenu(null);
              props.onClick();
            }}
            type="button"
          >
            <MdiIcon name="mdi-dots-vertical" />
          </button>
        )}
      >
        <div
          className="header-menu-group"
          onMouseEnter={() => !mobile && openSubmenu('language')}
          onMouseLeave={() => !mobile && scheduleSubmenuClose()}
        >
          <button
            aria-expanded={submenu === 'language'}
            className={`headless-menu__item header-menu-group__trigger${submenu === 'language' ? ' is-active' : ''}`}
            onClick={() => setSubmenu((current) => (current === 'language' ? null : 'language'))}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            <span className="headless-menu__item-label">
              <MdiIcon name="mdi-translate" />
              {t('core.common.language')}
            </span>
            <span className="header-menu-group__current">
              <span>{currentLanguage.flag}</span>
              <MdiIcon name="mdi-chevron-right" />
            </span>
          </button>
          {submenu === 'language' && (
            <div aria-label={t('core.common.language')} className="header-submenu header-submenu--language" role="menu">
              {localeRegistry.map((language) => (
                <button
                  className={i18n.language === language.code ? 'is-active' : ''}
                  key={language.code}
                  onClick={() => {
                    void i18n.changeLanguage(language.code);
                    setSubmenu(null);
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  <span>{language.flag}</span>
                  <span>{language.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="header-menu-group"
          onMouseEnter={() => !mobile && openSubmenu('theme')}
          onMouseLeave={() => !mobile && scheduleSubmenuClose()}
        >
          <button
            aria-expanded={submenu === 'theme'}
            className={`headless-menu__item header-menu-group__trigger${submenu === 'theme' ? ' is-active' : ''}`}
            onClick={() => setSubmenu((current) => (current === 'theme' ? null : 'theme'))}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            <span className="headless-menu__item-label">
              <MdiIcon name="mdi-brightness-6" />
              {t('core.header.buttons.theme.title')}
            </span>
            <span className="header-menu-group__current">
              <MdiIcon name={currentTheme.icon} />
              <MdiIcon name="mdi-chevron-right" />
            </span>
          </button>
          {submenu === 'theme' && (
            <div
              aria-label={t('core.header.buttons.theme.title')}
              className="header-submenu header-submenu--theme"
              role="menu"
            >
              {themeOptions.map((theme) => (
                <button
                  className={themeMode === theme.mode ? 'is-active' : ''}
                  key={theme.mode}
                  onClick={() => {
                    setThemeMode(theme.mode);
                    setSubmenu(null);
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  <MdiIcon name={theme.icon} />
                  <span>{t(theme.labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <MenuItem onSelect={openUpdate}>
          <span className="headless-menu__item-label">
            <MdiIcon name="mdi-arrow-up-circle" />
            {t('core.header.updateDialog.title')}
          </span>
        </MenuItem>
      </Menu>
      <Dialog onOpenChange={setUpdateOpen} open={updateOpen} title={t('core.header.updateDialog.title')}>
        <div className="header-update-dialog">
          <div className="header-update-status">
            <span>{t('core.header.updateDialog.currentVersion')}</span>
            <strong>{String(updateInfo.version || '—')}</strong>
          </div>
          {Boolean(updateInfo.desktop) && (
            <div className="header-update-status">
              <span>{t('core.header.updateDialog.desktopApp.latestVersion')}</span>
              <strong>{String(updateInfo.latest_version || '—')}</strong>
            </div>
          )}
          {Boolean(updateInfo.dashboard_version) && (
            <div className="header-update-status">
              <span>WebUI</span>
              <strong>{String(updateInfo.dashboard_version)}</strong>
            </div>
          )}
          <p>
            {updateChecking
              ? t('core.header.updateDialog.status.checking')
              : updateInfo.has_new_version
                ? t('core.header.version.hasNewVersion')
                : t('core.header.updateDialog.dashboardUpdate.isLatest')}
          </p>
          <DialogActions>
            <DialogCancel>{t('core.actions.close')}</DialogCancel>
            <Button disabled={updateChecking} onClick={() => void loadUpdate()}>
              {t('core.header.buttons.update')}
            </Button>
            <Button
              disabled={updateChecking || updateInstalling || !updateInfo.has_new_version}
              onClick={() => void installUpdate()}
              variant="primary"
            >
              {updateInstalling
                ? t('core.header.updateDialog.status.updating')
                : t('core.header.updateDialog.updateToLatest')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </>
  );
}
