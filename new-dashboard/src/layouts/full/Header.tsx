import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { statsApi, updatesApi } from '@/api/compat';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { Menu, MenuItem } from '@/components/headless/Menu';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { errorMessage, JsonObject, responseData } from '@/routes/configuration/model';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/feedback';
import { type ThemeMode, useLayoutStore } from '@/stores/layout';
import { useDesktopStore } from '@/stores/desktop';
import { useDesktop } from '@/desktop/DesktopProvider';
import {
  passwordWarningFromFlags,
  persistPasswordSecurityFlags,
  readPasswordWarning,
  type PasswordSecurityFlags,
  type PasswordWarning,
} from './shellStartup';

export const LAST_BOT_ROUTE_KEY = 'astrbot:last_bot_route';
export const LAST_CHAT_ROUTE_KEY = 'astrbot:last_chat_route';

export function headerUpdateRuntime(isDesktop: boolean) {
  return isDesktop ? 'desktop' : 'web';
}

export async function runHeaderUpdateAction(
  isDesktop: boolean,
  desktopAction: () => Promise<unknown>,
  webAction: () => Promise<unknown>,
) {
  return headerUpdateRuntime(isDesktop) === 'desktop'
    ? desktopAction()
    : webAction();
}

export function getModeSwitchTarget(pathname: string, storage: Pick<Storage, 'getItem'>) {
  if (pathname === '/chat' || pathname.startsWith('/chat/')) {
    const lastBotRoute = storage.getItem(LAST_BOT_ROUTE_KEY) || '/';
    return lastBotRoute.startsWith('/chat') ? '/' : lastBotRoute;
  }
  const lastChatId = storage.getItem(LAST_CHAT_ROUTE_KEY);
  return lastChatId ? `/chat/${lastChatId}` : '/chat';
}

const languageOptions = [
  { code: 'zh-CN', label: '简体中文', flag: 'CN' },
  { code: 'en-US', label: 'English', flag: 'US' },
  { code: 'ru-RU', label: 'Русский', flag: 'RU' },
] as const;

const themeOptions: Array<{ icon: `mdi-${string}`; mode: ThemeMode; labelKey: string }> = [
  { icon: 'mdi-white-balance-sunny', mode: 'light', labelKey: 'core.header.buttons.theme.light' },
  { icon: 'mdi-weather-night', mode: 'dark', labelKey: 'core.header.buttons.theme.dark' },
  { icon: 'mdi-sync', mode: 'system', labelKey: 'core.header.buttons.theme.system' },
];

export function Header() {
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 767px)').matches ?? window.innerWidth < 768);
  const [submenu, setSubmenu] = useState<'language' | 'theme' | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<JsonObject>({});
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountWarning, setAccountWarning] = useState<PasswordWarning>(() => readPasswordWarning(localStorage));
  const [accountSaving, setAccountSaving] = useState(false);
  const [account, setAccount] = useState({ password: '', newPassword: '', confirmPassword: '', username: '' });
  const submenuTimer = useRef<number | null>(null);
  const drawerOpen = useLayoutStore((state) => state.drawerOpen);
  const chatSidebarOpen = useLayoutStore((state) => state.chatSidebarOpen);
  const miniSidebar = useLayoutStore((state) => state.miniSidebar);
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setDrawerOpen = useLayoutStore((state) => state.setDrawerOpen);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);
  const toggleDrawer = useLayoutStore((state) => state.toggleDrawer);
  const toggleChatSidebar = useLayoutStore((state) => state.toggleChatSidebar);
  const toggleMiniSidebar = useLayoutStore((state) => state.toggleMiniSidebar);
  const clearSession = useAuthStore((state) => state.clearSession);
  const isDesktop = useDesktopStore((state) => state.isDesktop);
  const { checkForUpdate: checkDesktopUpdate, installUpdate: installDesktopUpdate } = useDesktop();
  const isChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/');

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 767px)');
    const updateViewport = (nextMobile: boolean) => {
      setMobile((wasMobile) => {
        if (wasMobile !== nextMobile) setDrawerOpen(!nextMobile);
        return nextMobile;
      });
    };
    if (media) {
      const handleChange = (event: MediaQueryListEvent) => updateViewport(event.matches);
      updateViewport(media.matches);
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    const handleResize = () => updateViewport(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setDrawerOpen]);

  useEffect(() => {
    if (isChat) {
      const conversationId = location.pathname.split('/')[2];
      if (conversationId) sessionStorage.setItem(LAST_CHAT_ROUTE_KEY, conversationId);
    } else {
      sessionStorage.setItem(LAST_BOT_ROUTE_KEY, `${location.pathname}${location.search}${location.hash}`);
    }
  }, [isChat, location.hash, location.pathname, location.search]);

  useEffect(() => () => {
    if (submenuTimer.current != null) window.clearTimeout(submenuTimer.current);
  }, []);

  useEffect(() => {
    if (accountWarning) setAccountOpen(true);
    let active = true;
    void statsApi.version()
      .then((response) => {
        if (!active) return;
        const data = responseData<JsonObject>(response) ?? {};
        const flags: PasswordSecurityFlags = {
          change_pwd_hint: Boolean(data.change_pwd_hint),
          md5_pwd_hint: Boolean(data.md5_pwd_hint),
          password_upgrade_required: Boolean(data.password_upgrade_required),
        };
        persistPasswordSecurityFlags(flags, localStorage);
        const warning = passwordWarningFromFlags(flags);
        setAccountWarning(warning);
        if (warning) setAccountOpen(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const currentLanguage = languageOptions.find((item) => item.code === i18n.language) || languageOptions[0];
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
        const result = await runHeaderUpdateAction(
          true,
          checkDesktopUpdate,
          async () => null,
        ) as AstrBotDesktopAppUpdateCheckResult | null;
        if (!result?.ok) throw new Error(result?.reason || t('core.header.updateDialog.desktopApp.checkFailed'));
        setUpdateInfo({
          desktop: true,
          has_new_version: result.hasUpdate,
          latest_version: result.latestVersion || '—',
          version: result.currentVersion || '—',
        });
        return;
      }
      const response = await runHeaderUpdateAction(
        false,
        async () => null,
        updatesApi.check,
      );
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
        const result = await runHeaderUpdateAction(
          true,
          installDesktopUpdate,
          async () => ({ ok: false }),
        ) as AstrBotDesktopResult;
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

  const saveAccount = async () => {
    if (!account.password) {
      toast.warning(t('core.header.accountDialog.validation.passwordRequired'));
      return;
    }
    if (account.newPassword && account.newPassword !== account.confirmPassword) {
      toast.warning(t('core.header.accountDialog.validation.passwordMatch'));
      return;
    }
    if (account.newPassword && account.newPassword.length < 8) {
      toast.warning(t('core.header.accountDialog.validation.passwordMinLength'));
      return;
    }
    if (account.newPassword && !/[A-Z]/.test(account.newPassword)) {
      toast.warning(t('core.header.accountDialog.validation.passwordUppercase'));
      return;
    }
    if (account.newPassword && !/[a-z]/.test(account.newPassword)) {
      toast.warning(t('core.header.accountDialog.validation.passwordLowercase'));
      return;
    }
    if (account.newPassword && !/\d/.test(account.newPassword)) {
      toast.warning(t('core.header.accountDialog.validation.passwordDigit'));
      return;
    }
    if (account.username.trim() && account.username.trim().length < 3) {
      toast.warning(t('core.header.accountDialog.validation.usernameMinLength'));
      return;
    }
    setAccountSaving(true);
    try {
      const response = await authApi.updateAccount({
        password: account.password,
        new_password: account.newPassword || undefined,
        confirm_password: account.confirmPassword || undefined,
        new_username: account.username.trim() || undefined,
      });
      if (response.data.status === 'error') {
        throw new Error(response.data.message || t('core.header.accountDialog.messages.updateFailed'));
      }
      await authApi.logout().catch(() => undefined);
      setAccountOpen(false);
      setAccountWarning(null);
      setAccount({ password: '', newPassword: '', confirmPassword: '', username: '' });
      clearSession();
      navigate('/auth/login', { replace: true });
    } catch (cause) {
      toast.error(errorMessage(cause, t('core.header.accountDialog.messages.updateFailed')));
    } finally {
      setAccountSaving(false);
    }
  };

  return <>
    <div className={`app-header${isChat ? ' app-header--chat' : ''}`}>
      {!isChat && (
        <button
          aria-label={mobile ? t('core.header.buttons.openSidebar', 'Toggle sidebar') : t('core.header.buttons.collapseSidebar', 'Collapse sidebar')}
          aria-pressed={mobile ? drawerOpen : miniSidebar}
          className="app-header__icon-button"
          onClick={mobile ? toggleDrawer : toggleMiniSidebar}
          type="button"
        >
          <MdiIcon name="mdi-menu" />
        </button>
      )}
      {!isChat && <Link className="app-header__logo" to="/about">Astr<span>Bot</span></Link>}
      {isChat && mobile && (
        <button
          aria-label={t('core.header.buttons.openSidebar', 'Toggle chat sidebar')}
          aria-pressed={chatSidebarOpen}
          className="app-header__icon-button"
          onClick={toggleChatSidebar}
          type="button"
        >
          <MdiIcon name={chatSidebarOpen ? 'mdi-chevron-left' : 'mdi-chevron-right'} />
        </button>
      )}
      <div className="app-header__spacer" />
      <button
        className="app-header__mode-switch"
        onClick={() => navigate(getModeSwitchTarget(location.pathname, sessionStorage))}
        type="button"
      >
        <MdiIcon name={isChat ? 'mdi-robot' : 'mdi-chat'} />
        {isChat ? 'Bot' : 'Chat'}
      </button>
      <Menu
        className="app-header__menu"
        label={t('core.header.buttons.menu', 'Application menu')}
        trigger={(props) => (
          <button {...props} aria-label={t('core.header.buttons.menu', 'Application menu')} className="app-header__icon-button app-header__menu-button" onClick={() => { setSubmenu(null); props.onClick(); }} type="button"><MdiIcon name="mdi-dots-vertical" /></button>
        )}
      >
        <div className="header-menu-group" onMouseEnter={() => !mobile && openSubmenu('language')} onMouseLeave={() => !mobile && scheduleSubmenuClose()}>
          <button aria-expanded={submenu === 'language'} className={`headless-menu__item header-menu-group__trigger${submenu === 'language' ? ' is-active' : ''}`} onClick={() => setSubmenu((current) => current === 'language' ? null : 'language')} role="menuitem" tabIndex={-1} type="button">
            <span className="headless-menu__item-label"><MdiIcon name="mdi-translate" />{t('core.common.language')}</span>
            <span className="header-menu-group__current"><span>{currentLanguage.flag}</span><MdiIcon name="mdi-chevron-right" /></span>
          </button>
          {submenu === 'language' && <div aria-label={t('core.common.language')} className="header-submenu header-submenu--language" role="menu">
            {languageOptions.map((language) => <button className={i18n.language === language.code ? 'is-active' : ''} key={language.code} onClick={() => { void i18n.changeLanguage(language.code); setSubmenu(null); }} role="menuitem" tabIndex={-1} type="button"><span>{language.flag}</span><span>{language.label}</span></button>)}
          </div>}
        </div>
        <div className="header-menu-group" onMouseEnter={() => !mobile && openSubmenu('theme')} onMouseLeave={() => !mobile && scheduleSubmenuClose()}>
          <button aria-expanded={submenu === 'theme'} className={`headless-menu__item header-menu-group__trigger${submenu === 'theme' ? ' is-active' : ''}`} onClick={() => setSubmenu((current) => current === 'theme' ? null : 'theme')} role="menuitem" tabIndex={-1} type="button">
            <span className="headless-menu__item-label"><MdiIcon name="mdi-brightness-6" />{t('core.header.buttons.theme.title')}</span>
            <span className="header-menu-group__current"><MdiIcon name={currentTheme.icon} /><MdiIcon name="mdi-chevron-right" /></span>
          </button>
          {submenu === 'theme' && <div aria-label={t('core.header.buttons.theme.title')} className="header-submenu header-submenu--theme" role="menu">
            {themeOptions.map((theme) => <button className={themeMode === theme.mode ? 'is-active' : ''} key={theme.mode} onClick={() => { setThemeMode(theme.mode); setSubmenu(null); }} role="menuitem" tabIndex={-1} type="button"><MdiIcon name={theme.icon} /><span>{t(theme.labelKey)}</span></button>)}
          </div>}
        </div>
        <MenuItem onSelect={openUpdate}><span className="headless-menu__item-label"><MdiIcon name="mdi-arrow-up-circle" />{t('core.header.updateDialog.title')}</span></MenuItem>
        <MenuItem onSelect={() => setAccountOpen(true)}><span className="headless-menu__item-label"><MdiIcon name="mdi-account" />{t('core.header.accountDialog.title')}</span></MenuItem>
      </Menu>
    </div>
    <Dialog onOpenChange={setUpdateOpen} open={updateOpen} title={t('core.header.updateDialog.title')}>
      <div className="header-update-dialog">
        <div className="header-update-status"><span>{t('core.header.updateDialog.currentVersion')}</span><strong>{String(updateInfo.version || '—')}</strong></div>
        {Boolean(updateInfo.desktop) && <div className="header-update-status"><span>{t('core.header.updateDialog.desktopApp.latestVersion')}</span><strong>{String(updateInfo.latest_version || '—')}</strong></div>}
        {Boolean(updateInfo.dashboard_version) && <div className="header-update-status"><span>WebUI</span><strong>{String(updateInfo.dashboard_version)}</strong></div>}
        <p>{updateChecking ? t('core.header.updateDialog.status.checking') : updateInfo.has_new_version ? t('core.header.version.hasNewVersion') : t('core.header.updateDialog.dashboardUpdate.isLatest')}</p>
        <DialogActions><DialogCancel>{t('core.header.accountDialog.actions.cancel')}</DialogCancel><Button disabled={updateChecking} onClick={() => void loadUpdate()}>{t('core.header.buttons.update')}</Button><Button disabled={updateChecking || updateInstalling || !updateInfo.has_new_version} onClick={() => void installUpdate()} variant="primary">{updateInstalling ? t('core.header.updateDialog.status.updating') : t('core.header.updateDialog.updateToLatest')}</Button></DialogActions>
      </div>
    </Dialog>
    <Dialog onOpenChange={setAccountOpen} open={accountOpen} title={t('core.header.accountDialog.title')}>
      <div className="dialog-form header-account-form">
        {accountWarning && <p className="auth-warning" role="status">{t(`core.header.accountDialog.${accountWarning === 'upgrade' ? 'securityWarningUpgrade' : accountWarning === 'md5' ? 'securityWarningMd5' : 'securityWarning'}`)}</p>}
        <label>{t('core.header.accountDialog.form.currentPassword')}<input autoComplete="current-password" onChange={(event) => setAccount({ ...account, password: event.target.value })} type="password" value={account.password} /></label>
        <label>{t('core.header.accountDialog.form.newPassword')}<input autoComplete="new-password" onChange={(event) => setAccount({ ...account, newPassword: event.target.value })} type="password" value={account.newPassword} /><small>{t('core.header.accountDialog.form.passwordHint')}</small></label>
        <label>{t('core.header.accountDialog.form.confirmPassword')}<input autoComplete="new-password" onChange={(event) => setAccount({ ...account, confirmPassword: event.target.value })} type="password" value={account.confirmPassword} /></label>
        <label>{t('core.header.accountDialog.form.newUsername')}<input autoComplete="username" onChange={(event) => setAccount({ ...account, username: event.target.value })} value={account.username} /></label>
        <DialogActions><DialogCancel>{t('core.header.accountDialog.actions.cancel')}</DialogCancel><Button disabled={accountSaving} onClick={() => void saveAccount()} variant="primary">{t('core.header.accountDialog.actions.save')}</Button></DialogActions>
      </div>
    </Dialog>
  </>;
}
