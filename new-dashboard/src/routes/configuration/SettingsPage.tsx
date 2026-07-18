import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createApiKey, deleteApiKey, getSystemConfig, listApiKeys, revokeApiKey } from '@/api/openapi';
import { SystemConfigTwoFactorRequired, systemConfigApi } from '@/api/services';
import { ConfigGroup } from '@/components/config/DynamicConfigForm';
import { isConfigRecord, type ConfigGroupMetadata, type ConfigItemMetadata, type ConfigRecord } from '@/components/config/configFormModel';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { useDesktop } from '@/desktop/DesktopProvider';
import { useDesktopStore } from '@/stores/desktop';
import { confirmAction, toast } from '@/stores/feedback';
import { acquireActionLock } from '@/utils/actionLock';
import { LoadingState } from './ConfigurationUi';
import { errorMessage, JsonObject, objectList, recordId, responseData } from './model';
import { BackupDialog, ProxySelector, SidebarCustomizer, StorageCleanupPanel } from './SettingsExtras';

type SettingsSection = 'general' | 'appearance' | 'network' | 'security' | 'maintenance' | 'openapi' | 'about';
type ApiScope = 'bot' | 'provider' | 'persona' | 'im' | 'config' | 'chat' | 'data' | 'file' | 'plugin' | 'mcp' | 'skill';

const SYSTEM_GROUPS = {
  runtime: ['timezone', 'callback_api_base'],
  network: ['http_proxy', 'no_proxy', 'pip_install_arg', 'pypi_index_url'],
  webuiSecurity: ['dashboard.trust_proxy_headers', 'dashboard.ssl.enable', 'dashboard.ssl.cert_file', 'dashboard.ssl.key_file', 'dashboard.ssl.ca_certs', 'dashboard.auth_rate_limit.enable', 'dashboard.auth_rate_limit.average_interval', 'dashboard.auth_rate_limit.max_burst', 'dashboard.totp.enable'],
  logs: ['log_level', 'log_file_enable', 'log_file_path', 'log_file_max_mb', 'trace_log_enable', 'trace_log_path', 'trace_log_max_mb'],
  tempStorage: ['temp_dir_max_size'],
  t2iRendering: ['t2i_strategy', 't2i_endpoint', 't2i_template', 't2i_active_template'],
} as const;

const NAV_ITEMS: Array<{ icon: `mdi-${string}`; id: SettingsSection }> = [
  { id: 'general', icon: 'mdi-tune-variant' },
  { id: 'appearance', icon: 'mdi-palette-outline' },
  { id: 'network', icon: 'mdi-lan-connect' },
  { id: 'security', icon: 'mdi-shield-lock-outline' },
  { id: 'maintenance', icon: 'mdi-tools' },
  { id: 'openapi', icon: 'mdi-api' },
  { id: 'about', icon: 'mdi-information-outline' },
];

const API_SCOPES: ApiScope[] = ['bot', 'provider', 'persona', 'im', 'config', 'chat', 'data', 'file', 'plugin', 'mcp', 'skill'];

function systemMetadataRoot(metadata: ConfigRecord): ConfigGroupMetadata {
  const group = metadata.system_group;
  if (!isConfigRecord(group) || !isConfigRecord(group.metadata) || !isConfigRecord(group.metadata.system)) return { type: 'object', items: {} };
  return group.metadata.system as ConfigGroupMetadata;
}

function selectMetadata(metadata: ConfigGroupMetadata, keys: readonly string[]): ConfigGroupMetadata {
  const items = metadata.items ?? {};
  return { type: 'object', items: Object.fromEntries(keys.flatMap((key) => items[key] ? [[key, items[key] as ConfigItemMetadata]] : [])) };
}

export default function SettingsPage() {
  const { i18n, t } = useTranslation();
  const { restartBackend } = useDesktop();
  const prefix = 'features.settings';
  const initialSection = NAV_ITEMS.find((item) => window.location.hash.includes(item.id))?.id ?? 'general';
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [config, setConfig] = useState<ConfigRecord>({});
  const [metadata, setMetadata] = useState<ConfigRecord>({});
  const [saved, setSaved] = useState('{}');
  const [keys, setKeys] = useState<JsonObject[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [failedSave, setFailedSave] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiry, setExpiry] = useState<number | 'permanent'>(30);
  const [scopes, setScopes] = useState<ApiScope[]>(['bot', 'provider', 'im', 'config', 'chat', 'file']);
  const [createdKey, setCreatedKey] = useState('');
  const [keyCreating, setKeyCreating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorError, setTwoFactorError] = useState('');
  const [pendingConfig, setPendingConfig] = useState<{ config: ConfigRecord; snapshot: string } | null>(null);
  const [primary, setPrimary] = useState(() => localStorage.getItem('themePrimary') || '#3c96ca');
  const [secondary, setSecondary] = useState(() => localStorage.getItem('themeSecondary') || '#2f86bd');
  const createKeyLockRef = useRef({ current: false });
  const restartLockRef = useRef({ current: false });

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    setKeysError('');
    try {
      setKeys(objectList(responseData(await listApiKeys()), ['keys', 'api_keys', 'items']));
    } catch (cause) {
      const message = errorMessage(cause, t(`${prefix}.apiKey.messages.loadFailed`));
      setKeysError(message);
      toast.error(message);
    } finally {
      setKeysLoading(false);
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const configResponse = await getSystemConfig();
      const payload = responseData<JsonObject>(configResponse) ?? {};
      const nextConfig = isConfigRecord(payload.config) ? payload.config : payload;
      setConfig(nextConfig);
      setMetadata(isConfigRecord(payload.metadata) ? payload.metadata : {});
      setSaved(JSON.stringify(nextConfig));
      setRestartRequired(false);
    } catch (cause) {
      setError(errorMessage(cause, t(`${prefix}.systemConfig.messages.loadFailed`)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadKeys(); }, [loadKeys]);
  useEffect(() => {
    const item = NAV_ITEMS.find((navItem) => window.location.hash.includes(navItem.id));
    if (item) setSection(item.id);
  }, []);

  const rootMetadata = useMemo(() => systemMetadataRoot(metadata), [metadata]);
  const configSnapshot = useMemo(() => JSON.stringify(config), [config]);
  const resolveText = useCallback((path: string, field: 'description' | 'hint', fallback = '') => t(`features.config-metadata.${path}.${field}`, { defaultValue: fallback }), [t]);
  const twoFactorText = (key: string) => t(`features.config-metadata.system_group.system.dashboard.totp.${key}`);

  useEffect(() => {
    if (loading || saving || pendingConfig || configSnapshot === saved || configSnapshot === failedSave) return;
    const nextConfig = config;
    const timeout = window.setTimeout(() => {
      setSaving(true);
      void systemConfigApi.update(nextConfig)
        .then(() => {
          setSaved(configSnapshot);
          setFailedSave('');
          setRestartRequired(true);
          toast.success(t(`${prefix}.systemConfig.messages.saveSuccess`));
        })
        .catch((cause) => {
          if (cause instanceof SystemConfigTwoFactorRequired) {
            setPendingConfig({ config: nextConfig, snapshot: configSnapshot });
            setTwoFactorCode('');
            setTwoFactorError('');
            setTwoFactorOpen(true);
            return;
          }
          setFailedSave(configSnapshot);
          toast.error(errorMessage(cause, t(`${prefix}.systemConfig.messages.saveFailed`)));
        })
        .finally(() => setSaving(false));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [config, configSnapshot, failedSave, loading, pendingConfig, saved, saving, t]);

  const confirmTwoFactor = async () => {
    if (!pendingConfig || !twoFactorCode.trim()) return;
    setSaving(true);
    setTwoFactorError('');
    try {
      await systemConfigApi.update(pendingConfig.config, twoFactorCode.trim());
      setSaved(pendingConfig.snapshot);
      setFailedSave('');
      setPendingConfig(null);
      setTwoFactorOpen(false);
      setRestartRequired(true);
      toast.success(t(`${prefix}.systemConfig.messages.saveSuccess`));
    } catch (cause) {
      setTwoFactorError(
        cause instanceof SystemConfigTwoFactorRequired
          ? twoFactorText('configSaveError')
          : errorMessage(cause, twoFactorText('configSaveError')),
      );
    } finally {
      setSaving(false);
    }
  };

  const cancelTwoFactor = () => {
    try { setConfig(JSON.parse(saved) as ConfigRecord); } catch { /* keep the current form if the snapshot is invalid */ }
    setPendingConfig(null);
    setTwoFactorCode('');
    setTwoFactorError('');
    setTwoFactorOpen(false);
  };

  const applyColor = (name: 'primary' | 'secondary', value: string) => {
    const storageKey = name === 'primary' ? 'themePrimary' : 'themeSecondary';
    localStorage.setItem(storageKey, value);
    document.documentElement.style.setProperty(`--astrbot-${name}`, value);
    if (name === 'primary') setPrimary(value); else setSecondary(value);
  };

  const resetColors = () => {
    localStorage.removeItem('themePrimary'); localStorage.removeItem('themeSecondary');
    document.documentElement.style.removeProperty('--astrbot-primary'); document.documentElement.style.removeProperty('--astrbot-secondary');
    setPrimary('#3c96ca'); setSecondary('#2f86bd');
  };

  const addKey = async () => {
    if (!keyName.trim() || !scopes.length) return;
    const release = acquireActionLock(createKeyLockRef.current);
    if (!release) return;
    setKeyCreating(true);
    try {
      const data = responseData<JsonObject>(await createApiKey({ body: { name: keyName.trim(), scopes, ...(expiry === 'permanent' ? {} : { expires_in_days: expiry }) } }));
      const secret = data?.key ?? data?.api_key ?? data?.token;
      setCreatedKey(typeof secret === 'string' ? secret : '');
      setKeyName('');
      setExpiry(30);
      toast.success(t(`${prefix}.apiKey.messages.createSuccess`));
      await loadKeys();
      setSection('openapi');
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.apiKey.messages.createFailed`)));
    } finally {
      setKeyCreating(false);
      release();
    }
  };

  const toggleScope = (scope: ApiScope) => {
    setScopes((current) => {
      const selected = current.includes(scope);
      if (scope === 'config' && !selected) return API_SCOPES.filter((item) => new Set([...current, 'config', 'bot', 'provider']).has(item));
      const next = selected ? current.filter((item) => item !== scope) : [...current, scope];
      if (selected && (scope === 'bot' || scope === 'provider')) return next.filter((item) => item !== 'config');
      return next;
    });
  };

  const changeSection = (next: SettingsSection) => {
    setSection(next);
    const hash = next === 'general' ? 'system-config' : next === 'about' ? 'settings-about' : `settings-${next}`;
    window.history.replaceState(null, '', `${window.location.pathname}#${hash}`);
  };

  const removeKey = async (item: JsonObject) => {
    const id = recordId(item, 'key_id', 'id');
    if (!id || !await confirmAction({ danger: true, title: t(`${prefix}.apiKey.delete`), message: `${t(`${prefix}.apiKey.delete`)} ${String(item.name || id)}?` })) return;
    try {
      await deleteApiKey({ path: { key_id: id } });
      toast.success(t(`${prefix}.apiKey.messages.deleteSuccess`));
      await loadKeys();
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.apiKey.messages.deleteFailed`)));
    }
  };

  const revokeKey = async (item: JsonObject) => {
    const id = recordId(item, 'key_id', 'id');
    if (!id || !await confirmAction({ danger: true, title: t(`${prefix}.apiKey.revoke`), message: `${t(`${prefix}.apiKey.revoke`)} ${String(item.name || id)}?` })) return;
    try {
      await revokeApiKey({ path: { key_id: id } });
      toast.success(t(`${prefix}.apiKey.messages.revokeSuccess`));
      await loadKeys();
      setSection('openapi');
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.apiKey.messages.revokeFailed`)));
    }
  };

  const restart = async (needsConfirmation = true) => {
    const release = acquireActionLock(restartLockRef.current);
    if (!release) return;
    setRestarting(true);
    try {
      if (needsConfirmation && !await confirmAction({ danger: true, title: t(`${prefix}.system.restart.title`), message: t(`${prefix}.system.restart.confirm`) })) return;
      const ready = await restartBackend();
      if (!ready) {
        const cause = useDesktopStore.getState().error;
        toast.error(cause || t('core.common.restart.maxRetriesReached'));
        return;
      }
      toast.success(t(`${prefix}.system.restart.button`));
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.system.restart.title`)));
    } finally {
      setRestarting(false);
      release();
    }
  };

  const renderGroup = (group: keyof typeof SYSTEM_GROUPS) => <ConfigGroup key={group} metadata={selectMetadata(rootMetadata, SYSTEM_GROUPS[group])} onChange={setConfig} resolveText={resolveText} title={t(`${prefix}.systemConfig.groups.${group}.title`)} translationPath="system_group.system" value={config} variant="settings" />;

  const aboutDescriptions = i18n.resolvedLanguage === 'en-US'
    ? ['View updates for current and previous versions.', 'Open the official AstrBot documentation.', 'Browse common questions and troubleshooting guides.', 'Visit the AstrBot repository on GitHub.']
    : i18n.resolvedLanguage === 'ru-RU'
      ? ['Просмотреть изменения текущей и предыдущих версий.', 'Открыть официальную документацию AstrBot.', 'Открыть ответы на частые вопросы и инструкции.', 'Открыть репозиторий AstrBot на GitHub.']
      : ['查看当前版本和历史版本的更新内容。', '打开 AstrBot 官方文档。', '查看常见问题与排障说明。', '访问 AstrBot GitHub 仓库。'];
  const aboutResources = [
    { description: aboutDescriptions[0], icon: 'mdi-file-document-outline' as const, label: t('core.navigation.changelog'), url: 'https://github.com/AstrBotDevs/AstrBot/releases' },
    { description: aboutDescriptions[1], icon: 'mdi-book-open-variant' as const, label: t('core.navigation.documentation'), url: 'https://docs.astrbot.app/' },
    { description: aboutDescriptions[2], icon: 'mdi-frequently-asked-questions' as const, label: t('core.navigation.faq'), url: 'https://docs.astrbot.app/faq.html' },
    { description: aboutDescriptions[3], icon: 'mdi-github' as const, label: t('core.navigation.github'), url: 'https://github.com/AstrBotDevs/AstrBot' },
    { description: t('features.welcome.resources.afdianDesc'), icon: 'mdi-hand-heart' as const, label: t('features.welcome.resources.afdianTitle'), url: 'https://afdian.com/a/astrbot_team' },
  ];
  const pendingDashboard = pendingConfig && isConfigRecord(pendingConfig.config.dashboard) ? pendingConfig.config.dashboard : null;
  const pendingTotp = pendingDashboard && isConfigRecord(pendingDashboard.totp) ? pendingDashboard.totp : null;
  const showRotationHint = typeof pendingTotp?.secret === 'string' && pendingTotp.secret.trim().length > 0;

  return <div className="settings-page"><header className="settings-page__header"><h1 className="settings-page__title">{t(`${prefix}.page.title`)}</h1></header><div className="settings-layout"><nav aria-label={t(`${prefix}.page.title`)} className="settings-nav">{NAV_ITEMS.map((item) => <button aria-pressed={section === item.id} key={item.id} onClick={() => changeSection(item.id)} type="button"><MdiIcon name={item.icon} /><span>{item.id === 'about' ? t('core.navigation.about') : t(`${prefix}.sections.${item.id}.title`)}</span></button>)}</nav><main className="settings-main">
    {section === 'about' && <section className="settings-section"><header className="settings-section__heading"><h2 className="settings-section__title">{t('core.navigation.about')}</h2></header><div className="settings-about-card settings-list-card">{aboutResources.map((resource) => <article className="settings-about-item" key={resource.label}><div><strong>{resource.label}</strong><p>{resource.description}</p></div><a href={resource.url} rel="noreferrer" target="_blank"><MdiIcon name={resource.icon} />{resource.label}</a></article>)}</div></section>}
    {section !== 'about' && <>
    {restartRequired && <div className="settings-restart" role="status"><span><MdiIcon name="mdi-alert-circle" />{t(`${prefix}.systemConfig.restartRequired`)}</span><button disabled={restarting} onClick={() => void restart()} type="button"><MdiIcon className={restarting ? 'mdi-spin' : ''} name={restarting ? 'mdi-loading' : 'mdi-restart'} />{restarting ? t('core.common.restart.waiting') : t(`${prefix}.system.restart.button`)}</button></div>}
    {saving && <div className="settings-saving-bar" role="progressbar"><span /></div>}
    <LoadingState error={error} loading={loading} />
    {!loading && <section className="settings-section"><header className="settings-section__heading"><h2 className="settings-section__title">{t(`${prefix}.sections.${section}.title`)}</h2></header><div className="settings-section__content">
    {!loading && section === 'general' && <>{renderGroup('runtime')}{renderGroup('logs')}{renderGroup('tempStorage')}<StorageCleanupPanel /></>}
    {!loading && section === 'appearance' && <><section className="settings-list-card route-card"><div className="settings-item"><div><h2>{t(`${prefix}.sidebar.customize.title`)}</h2><p>{t(`${prefix}.sidebar.customize.subtitle`)}</p></div><div className="settings-item__control"><SidebarCustomizer /></div></div><div className="settings-item settings-item--color"><div><h2>{t(`${prefix}.theme.customize.title`)}</h2><p>{t(`${prefix}.theme.subtitle`)}</p></div><div className="settings-color-controls"><label>{t(`${prefix}.theme.customize.primary`)}<input onChange={(event) => applyColor('primary', event.target.value)} type="color" value={primary} /></label><label>{t(`${prefix}.theme.customize.secondary`)}<input onChange={(event) => applyColor('secondary', event.target.value)} type="color" value={secondary} /></label><button onClick={resetColors} type="button"><MdiIcon name="mdi-restore" />{t(`${prefix}.theme.customize.reset`)}</button></div></div></section>{renderGroup('t2iRendering')}</>}
    {!loading && section === 'network' && <>{renderGroup('network')}<section className="settings-list-card route-card"><div className="settings-item settings-item--stack"><div><h2>{t(`${prefix}.network.githubProxy.title`)}</h2><p>{t(`${prefix}.network.githubProxy.subtitle`)}</p></div><ProxySelector /></div></section></>}
    {!loading && section === 'security' && renderGroup('webuiSecurity')}
    {!loading && section === 'maintenance' && <section className="settings-list-card route-card"><div className="settings-item"><div><h2>{t(`${prefix}.system.backup.title`)}</h2><p>{t(`${prefix}.system.backup.subtitle`)}</p></div><button onClick={() => setBackupOpen(true)} type="button"><MdiIcon name="mdi-backup-restore" />{t(`${prefix}.system.backup.button`)}</button></div><div className="settings-item"><div><h2>{t(`${prefix}.system.restart.title`)}</h2><p>{t(`${prefix}.system.restart.subtitle`)}</p></div><button className="button--danger" disabled={restarting} onClick={() => void restart()} type="button"><MdiIcon className={restarting ? 'mdi-spin' : ''} name={restarting ? 'mdi-loading' : 'mdi-restart'} />{restarting ? t('core.common.restart.waiting') : t(`${prefix}.system.restart.button`)}</button></div></section>}
    {!loading && section === 'openapi' && <section className="settings-list-card route-card"><header><h2>{t(`${prefix}.apiKey.manageTitle`)} <a aria-label={t(`${prefix}.apiKey.docsLink`)} href="https://docs.astrbot.app/dev/openapi.html" rel="noreferrer" target="_blank"><MdiIcon name="mdi-help-circle-outline" /></a></h2><p>{t(`${prefix}.apiKey.subtitle`)}</p></header>{keysError && <div className="settings-alert settings-alert--error">{keysError}</div>}<div className="api-key-create"><input disabled={keyCreating} onChange={(event) => setKeyName(event.target.value)} placeholder={t(`${prefix}.apiKey.name`)} value={keyName} /><select aria-label={t(`${prefix}.apiKey.expiresInDays`)} disabled={keyCreating} onChange={(event) => setExpiry(event.target.value === 'permanent' ? 'permanent' : Number(event.target.value))} value={expiry}><option value={1}>{t(`${prefix}.apiKey.expiryOptions.day1`)}</option><option value={7}>{t(`${prefix}.apiKey.expiryOptions.day7`)}</option><option value={30}>{t(`${prefix}.apiKey.expiryOptions.day30`)}</option><option value={90}>{t(`${prefix}.apiKey.expiryOptions.day90`)}</option><option value="permanent">{t(`${prefix}.apiKey.expiryOptions.permanent`)}</option></select><button disabled={keyCreating || !keyName.trim() || !scopes.length} onClick={() => void addKey()} type="button"><MdiIcon className={keyCreating ? 'mdi-spin' : ''} name={keyCreating ? 'mdi-loading' : 'mdi-key-plus'} />{t(`${prefix}.apiKey.create`)}</button></div>{expiry === 'permanent' && <div className="settings-alert settings-alert--warning">{t(`${prefix}.apiKey.permanentWarning`)}</div>}<div className="api-key-scopes"><span>{t(`${prefix}.apiKey.scopes`)}</span>{API_SCOPES.map((scope) => <label className={scopes.includes(scope) ? 'is-selected' : ''} key={scope}><input checked={scopes.includes(scope)} disabled={keyCreating} onChange={() => toggleScope(scope)} type="checkbox" />{scope}</label>)}</div>{createdKey && <div className="config-secret" role="status"><strong>{t(`${prefix}.apiKey.plaintextHint`)}</strong><code>{createdKey}</code><button onClick={() => void navigator.clipboard?.writeText(createdKey).then(() => toast.success(t(`${prefix}.apiKey.messages.copySuccess`))).catch(() => toast.error(t(`${prefix}.apiKey.messages.copyFailed`)))} type="button"><MdiIcon name="mdi-content-copy" />{t(`${prefix}.apiKey.copy`)}</button></div>}<div className="monitor-table-wrap">{keysLoading ? <div className="monitor-empty"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : <><table className="monitor-table"><thead><tr><th>{t(`${prefix}.apiKey.table.name`)}</th><th>{t(`${prefix}.apiKey.table.scopes`)}</th><th>{t(`${prefix}.apiKey.table.status`)}</th><th>{t(`${prefix}.apiKey.table.lastUsed`)}</th><th>{t(`${prefix}.apiKey.table.createdAt`)}</th><th>{t(`${prefix}.apiKey.table.actions`)}</th></tr></thead><tbody>{keys.map((item, index) => { const id = recordId(item, 'key_id', 'id') || `key-${index}`; const inactive = Boolean(item.is_revoked || item.is_expired); return <tr key={id}><td><strong>{String(item.name || id)}</strong><small>{String(item.key_prefix || '')}</small></td><td>{Array.isArray(item.scopes) ? item.scopes.join(', ') : '—'}</td><td><span className={`status-chip ${inactive ? 'status-chip--error' : 'status-chip--success'}`}>{t(`${prefix}.apiKey.status.${inactive ? 'inactive' : 'active'}`)}</span></td><td>{item.last_used_at ? new Date(String(item.last_used_at)).toLocaleString() : '—'}</td><td>{item.created_at ? new Date(String(item.created_at)).toLocaleString() : '—'}</td><td><div className="api-key-actions">{!inactive && <button onClick={() => void revokeKey(item)} type="button">{t(`${prefix}.apiKey.revoke`)}</button>}<button className="button--danger" onClick={() => void removeKey(item)} type="button">{t(`${prefix}.apiKey.delete`)}</button></div></td></tr>; })}</tbody></table>{!keys.length && <div className="monitor-empty">{t(`${prefix}.apiKey.empty`)}</div>}</>}</div></section>}
    </div></section>}
    </>}
  </main></div><BackupDialog onRestart={() => restart(false)} open={backupOpen} restarting={restarting} setOpen={setBackupOpen} /><Dialog onOpenChange={(open) => { if (!open) cancelTwoFactor(); }} open={twoFactorOpen} title={twoFactorText('configSaveTitle')}><div className="settings-two-factor"><p>{twoFactorText('configSaveSubtitle')}</p><label>{twoFactorText('configSaveCode')}<input autoFocus inputMode="numeric" maxLength={8} onChange={(event) => setTwoFactorCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void confirmTwoFactor(); }} value={twoFactorCode} /></label>{showRotationHint && <div className="settings-alert settings-alert--info">{twoFactorText('configSaveRotationHint')}</div>}{twoFactorError && <div className="settings-alert settings-alert--error">{twoFactorError}</div>}<DialogActions><DialogCancel onClick={cancelTwoFactor}>{twoFactorText('configSaveCancel')}</DialogCancel><Button disabled={!twoFactorCode.trim() || saving} onClick={() => void confirmTwoFactor()} variant="primary">{twoFactorText('configSaveConfirm')}</Button></DialogActions></div></Dialog></div>;
}
