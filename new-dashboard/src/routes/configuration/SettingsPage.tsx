import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createApiKey, deleteApiKey, getSystemConfig, listApiKeys, restartCore, updateSystemConfig } from '@/api/openapi';
import { ConfigGroup } from '@/components/config/DynamicConfigForm';
import { isConfigRecord, type ConfigGroupMetadata, type ConfigItemMetadata, type ConfigRecord } from '@/components/config/configFormModel';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { LoadingState } from './ConfigurationUi';
import { errorMessage, JsonObject, objectList, recordId, responseData } from './model';

type SettingsSection = 'general' | 'appearance' | 'network' | 'security' | 'maintenance' | 'openapi';
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
  const { t } = useTranslation();
  const prefix = 'features.settings';
  const initialSection = NAV_ITEMS.find((item) => window.location.hash.includes(item.id))?.id ?? 'general';
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [config, setConfig] = useState<ConfigRecord>({});
  const [metadata, setMetadata] = useState<ConfigRecord>({});
  const [saved, setSaved] = useState('{}');
  const [keys, setKeys] = useState<JsonObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiry, setExpiry] = useState<number | 'permanent'>(30);
  const [scopes, setScopes] = useState<ApiScope[]>(['bot', 'provider', 'im', 'config', 'chat', 'file']);
  const [createdKey, setCreatedKey] = useState('');
  const [primary, setPrimary] = useState(() => localStorage.getItem('themePrimary') || '#3c96ca');
  const [secondary, setSecondary] = useState(() => localStorage.getItem('themeSecondary') || '#2f86bd');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configResponse, keyResponse] = await Promise.all([getSystemConfig(), listApiKeys().catch(() => null)]);
      const payload = responseData<JsonObject>(configResponse) ?? {};
      const nextConfig = isConfigRecord(payload.config) ? payload.config : payload;
      setConfig(nextConfig);
      setMetadata(isConfigRecord(payload.metadata) ? payload.metadata : {});
      setSaved(JSON.stringify(nextConfig));
      setKeys(objectList(responseData(keyResponse), ['keys', 'api_keys', 'items']));
      setRestartRequired(false);
    } catch (cause) {
      setError(errorMessage(cause, t(`${prefix}.systemConfig.messages.loadFailed`)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const rootMetadata = useMemo(() => systemMetadataRoot(metadata), [metadata]);
  const dirty = JSON.stringify(config) !== saved;
  const resolveText = useCallback((path: string, field: 'description' | 'hint', fallback = '') => t(`features.config-metadata.${path}.${field}`, { defaultValue: fallback }), [t]);

  const save = async () => {
    setSaving(true);
    try {
      await updateSystemConfig({ body: config });
      setSaved(JSON.stringify(config));
      setRestartRequired(true);
      toast.success(t(`${prefix}.systemConfig.messages.saveSuccess`));
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.systemConfig.messages.saveFailed`)));
    } finally {
      setSaving(false);
    }
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
    try {
      const data = responseData<JsonObject>(await createApiKey({ body: { name: keyName.trim(), scopes, ...(expiry === 'permanent' ? {} : { expires_in_days: expiry }) } }));
      const secret = data?.key ?? data?.api_key ?? data?.token;
      setCreatedKey(typeof secret === 'string' ? secret : '');
      setKeyName('');
      toast.success(t(`${prefix}.apiKey.messages.createSuccess`));
      await load();
      setSection('openapi');
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.apiKey.messages.createFailed`)));
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

  const removeKey = async (item: JsonObject) => {
    const id = recordId(item, 'key_id', 'id');
    if (!id || !await confirmAction({ danger: true, title: t(`${prefix}.apiKey.delete`), message: `${t(`${prefix}.apiKey.delete`)} ${String(item.name || id)}?` })) return;
    try {
      await deleteApiKey({ path: { key_id: id } });
      toast.success(t(`${prefix}.apiKey.messages.deleteSuccess`));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, t(`${prefix}.apiKey.messages.deleteFailed`)));
    }
  };

  const restart = async () => {
    if (!await confirmAction({ danger: true, title: t(`${prefix}.system.restart.title`), message: t(`${prefix}.system.restart.confirm`) })) return;
    try { await restartCore(); toast.success(t(`${prefix}.system.restart.button`)); } catch (cause) { toast.error(errorMessage(cause, t(`${prefix}.system.restart.title`))); }
  };

  const renderGroup = (group: keyof typeof SYSTEM_GROUPS) => <ConfigGroup key={group} metadata={selectMetadata(rootMetadata, SYSTEM_GROUPS[group])} onChange={setConfig} resolveText={resolveText} title={t(`${prefix}.systemConfig.groups.${group}.title`)} translationPath="system_group.system" value={config} />;

  return <div className="settings-page"><header className="settings-page__header"><h1>{t(`${prefix}.page.title`)}</h1><div className="settings-page__actions"><button disabled={!dirty || loading} onClick={() => setConfig(JSON.parse(saved) as ConfigRecord)} type="button">{t('core.actions.reset')}</button><button className="button--primary" disabled={!dirty || saving || loading} onClick={() => void save()} type="button"><MdiIcon name="mdi-content-save" />{saving ? '…' : t('core.actions.save')}</button></div></header><div className="settings-layout"><nav aria-label={t(`${prefix}.page.title`)} className="settings-nav">{NAV_ITEMS.map((item) => <button aria-pressed={section === item.id} key={item.id} onClick={() => setSection(item.id)} type="button"><MdiIcon name={item.icon} /><span>{t(`${prefix}.sections.${item.id}.title`)}</span></button>)}</nav><main className="settings-main">
    {restartRequired && <div className="settings-restart" role="status"><span><MdiIcon name="mdi-alert-circle" />{t(`${prefix}.systemConfig.restartRequired`)}</span><button onClick={() => void restart()} type="button"><MdiIcon name="mdi-restart" />{t(`${prefix}.system.restart.button`)}</button></div>}
    <LoadingState error={error} loading={loading} />
    {!loading && section === 'general' && <>{renderGroup('runtime')}{renderGroup('logs')}{renderGroup('tempStorage')}</>}
    {!loading && section === 'appearance' && <><section className="settings-list-card route-card"><div className="settings-item"><div><h2>{t(`${prefix}.theme.customize.title`)}</h2><p>{t(`${prefix}.theme.subtitle`)}</p></div><div className="settings-color-controls"><label>{t(`${prefix}.theme.customize.primary`)}<input onChange={(event) => applyColor('primary', event.target.value)} type="color" value={primary} /></label><label>{t(`${prefix}.theme.customize.secondary`)}<input onChange={(event) => applyColor('secondary', event.target.value)} type="color" value={secondary} /></label><button onClick={resetColors} type="button"><MdiIcon name="mdi-restore" />{t(`${prefix}.theme.customize.reset`)}</button></div></div></section>{renderGroup('t2iRendering')}</>}
    {!loading && section === 'network' && renderGroup('network')}
    {!loading && section === 'security' && renderGroup('webuiSecurity')}
    {!loading && section === 'maintenance' && <section className="settings-list-card route-card"><div className="settings-item"><div><h2>{t(`${prefix}.system.restart.title`)}</h2><p>{t(`${prefix}.system.restart.subtitle`)}</p></div><button className="button--danger" onClick={() => void restart()} type="button"><MdiIcon name="mdi-restart" />{t(`${prefix}.system.restart.button`)}</button></div></section>}
    {!loading && section === 'openapi' && <section className="settings-list-card route-card"><header><h2>{t(`${prefix}.apiKey.manageTitle`)}</h2><p>{t(`${prefix}.apiKey.subtitle`)}</p></header><div className="api-key-create"><input onChange={(event) => setKeyName(event.target.value)} placeholder={t(`${prefix}.apiKey.name`)} value={keyName} /><select aria-label={t(`${prefix}.apiKey.expiresInDays`)} onChange={(event) => setExpiry(event.target.value === 'permanent' ? 'permanent' : Number(event.target.value))} value={expiry}><option value={1}>{t(`${prefix}.apiKey.expiryOptions.day1`)}</option><option value={7}>{t(`${prefix}.apiKey.expiryOptions.day7`)}</option><option value={30}>{t(`${prefix}.apiKey.expiryOptions.day30`)}</option><option value={90}>{t(`${prefix}.apiKey.expiryOptions.day90`)}</option><option value="permanent">{t(`${prefix}.apiKey.expiryOptions.permanent`)}</option></select><button disabled={!keyName.trim() || !scopes.length} onClick={() => void addKey()} type="button"><MdiIcon name="mdi-key-plus" />{t(`${prefix}.apiKey.create`)}</button></div><div className="api-key-scopes"><span>{t(`${prefix}.apiKey.scopes`)}</span>{API_SCOPES.map((scope) => <label className={scopes.includes(scope) ? 'is-selected' : ''} key={scope}><input checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} type="checkbox" />{scope}</label>)}</div>{createdKey && <div className="config-secret" role="status"><strong>{t(`${prefix}.apiKey.plaintextHint`)}</strong><code>{createdKey}</code><button onClick={() => void navigator.clipboard?.writeText(createdKey)} type="button"><MdiIcon name="mdi-content-copy" />{t(`${prefix}.apiKey.copy`)}</button></div>}<div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th>{t(`${prefix}.apiKey.table.name`)}</th><th>{t(`${prefix}.apiKey.table.scopes`)}</th><th>{t(`${prefix}.apiKey.table.status`)}</th><th>{t(`${prefix}.apiKey.table.createdAt`)}</th><th>{t(`${prefix}.apiKey.table.actions`)}</th></tr></thead><tbody>{keys.map((item, index) => { const id = recordId(item, 'key_id', 'id') || `key-${index}`; const inactive = item.is_revoked || item.is_expired; return <tr key={id}><td><strong>{String(item.name || id)}</strong><small>{String(item.key_prefix || '')}</small></td><td>{Array.isArray(item.scopes) ? item.scopes.join(', ') : '—'}</td><td><span className={`status-chip ${inactive ? 'status-chip--error' : 'status-chip--success'}`}>{t(`${prefix}.apiKey.status.${inactive ? 'inactive' : 'active'}`)}</span></td><td>{String(item.created_at || '—')}</td><td><button className="button--danger" onClick={() => void removeKey(item)} type="button">{t(`${prefix}.apiKey.delete`)}</button></td></tr>; })}</tbody></table>{!keys.length && <div className="monitor-empty">{t(`${prefix}.apiKey.empty`)}</div>}</div></section>}
  </main></div></div>;
}
