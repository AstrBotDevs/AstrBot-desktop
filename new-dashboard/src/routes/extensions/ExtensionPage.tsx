import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  bindPluginSource, checkPluginVersionSupport,
  getPluginConfigById, getPluginReadmeById,
  listCommands, listFailedPlugins, listPluginMarket,
  listPluginSources, listPlugins, reloadFailedPlugin, reloadPluginById, setPluginEnabledById,
  replacePluginSources, uninstallFailedPlugin, uninstallPluginById, updatePluginConfigById, updatePlugins,
} from '@/api/openapi';
import { Markdown } from '@/components/content/Markdown';
import { ConfigGroup } from '@/components/config/DynamicConfigForm';
import type { ConfigGroupMetadata } from '@/components/config/configFormModel';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, isObject, type JsonObject, recordId, responseData } from '@/routes/configuration/model';
import { ComponentsSection, McpSection, SkillsSection } from './ExtensionSections';
import { annotatePluginUpdates, getSelectedGitHubProxy, pluginBatchUpdateFailures, pluginUpdateTargets } from './extensionActions';
import { PLUGIN_SIDEBAR_CHANGED_EVENT } from '@/layouts/full/navigation';
import {
  addPluginPinyinSearchIndex, categoryValue, filterPlugins, localizedPluginConfigText, localizedPluginDescription, localizedPluginTitle, markdownContent,
  markInstalledMarketPlugins, marketCategoryCounts, marketPluginDisplayName, marketPluginList, normalizeMarketCategory,
  normalizePluginUrl, pluginAuthor, pluginDescription, pluginId, pluginInstallUrl, pluginList, pluginPages,
  pluginTitle, sortMarketPlugins, sourceList,
} from './extensionModel';
import { InstallPluginDialog } from './PluginInstallDialog';
import { PluginDetail } from './PluginDetail';

type ExtensionTab = 'installed' | 'components' | 'mcp' | 'skills' | 'market';
const validTabs: ExtensionTab[] = ['installed', 'market', 'components', 'mcp', 'skills'];
const PINNED_KEY = 'astrbot-extension-pinned';

export default function ExtensionPage() {
  const { pluginId: routePluginId } = useParams(); const location = useLocation();
  if (routePluginId) return <PluginDetail pluginId={routePluginId} source={location.hash === '#market' ? 'market' : 'installed'} />;
  return <ExtensionHome marketplaceRoute={location.pathname === '/extension-marketplace'} />;
}

function ExtensionHome({ marketplaceRoute }: { marketplaceRoute: boolean }) {
  const { t } = useTranslation(); const navigate = useNavigate(); const location = useLocation();
  const e = (key: string) => t(`features.extension.${key}`);
  const requested = marketplaceRoute ? 'market' : location.hash.slice(1);
  const activeTab = validTabs.includes(requested as ExtensionTab) ? requested as ExtensionTab : 'installed';
  const selectTab = (tab: ExtensionTab) => navigate(`/extension#${tab}`);
  return <div className="extension-page"><nav aria-label={e('title')} className="extension-tabs">{validTabs.map((tab) => <button aria-pressed={activeTab === tab} key={tab} onClick={() => selectTab(tab)} type="button"><MdiIcon name={tab === 'installed' ? 'mdi-puzzle' : tab === 'components' ? 'mdi-tune-variant' : tab === 'mcp' ? 'mdi-server' : tab === 'skills' ? 'mdi-lightning-bolt' : 'mdi-store'} />{e(tab === 'installed' ? 'tabs.installedPlugins' : tab === 'components' ? 'tabs.handlersOperation' : tab === 'mcp' ? 'tabs.installedMcpServers' : tab === 'skills' ? 'tabs.skills' : 'tabs.market')}</button>)}</nav>{activeTab === 'installed' && <InstalledPlugins />}{activeTab === 'components' && <ComponentsSection />}{activeTab === 'mcp' && <McpSection />}{activeTab === 'skills' && <SkillsSection />}{activeTab === 'market' && <PluginMarket />}</div>;
}

function InstalledPlugins() {
  const { t, i18n } = useTranslation(); const e = (key: string, options?: Record<string, unknown>) => t(`features.extension.${key}`, options); const navigate = useNavigate();
  const [items, setItems] = useState<JsonObject[]>([]); const [failed, setFailed] = useState<JsonObject[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(PINNED_KEY) || '[]'); } catch { return []; } });
  const [configPlugin, setConfigPlugin] = useState<JsonObject | null>(null); const [config, setConfig] = useState<JsonObject>({}); const [configMetadata, setConfigMetadata] = useState<JsonObject | null>(null); const [configI18n, setConfigI18n] = useState<unknown>({}); const [configLoading, setConfigLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [installOpen, setInstallOpen] = useState(false); const [uninstalling, setUninstalling] = useState<JsonObject | null>(null); const [deleteConfig, setDeleteConfig] = useState(false); const [deleteData, setDeleteData] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false); const [updateResult, setUpdateResult] = useState<{ message: string; status: 'loading' | 'success' | 'error' } | null>(null);
  const [documentDialog, setDocumentDialog] = useState<{ item: JsonObject; content: string; error: string; loading: boolean } | null>(null);
  const [sourceBinding, setSourceBinding] = useState<{ candidates: JsonObject[]; item: JsonObject; loading: boolean; saving: boolean; selected: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [pluginResponse, failedResponse] = await Promise.all([listPlugins({ query: { include_reserved: true } }), listFailedPlugins().catch(() => null)]);
      const installed = pluginList(responseData(pluginResponse));
      const registries = Array.from(new Set(installed.flatMap((item) => {
        const source = isObject(item.install_source) ? item.install_source : {};
        return item.updates_enabled && source.implicit !== true && source.install_method === 'market'
          ? [normalizePluginUrl(source.registry_url)]
          : [];
      })));
      const markets = new Map<string, JsonObject[]>();
      await Promise.all(registries.map(async (registry) => {
        try {
          const response = await listPluginMarket({ query: { custom_registry: registry || undefined, page: 1, page_size: 1000 } });
          markets.set(registry, marketPluginList(responseData(response)));
        } catch { markets.set(registry, []); }
      }));
      setItems(annotatePluginUpdates(installed, markets));
      window.dispatchEvent(new CustomEvent(PLUGIN_SIDEBAR_CHANGED_EVENT, { detail: installed }));
      setFailed(pluginList(responseData(failedResponse)));
    } catch (cause) { setError(errorMessage(cause, e('messages.refreshFailed'))); } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (item: JsonObject) => { const id = pluginId(item); try { await setPluginEnabledById({ body: { plugin_id: id, enabled: (item.activated ?? item.enabled) === false } }); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  const reload = async (item: JsonObject) => { const id = pluginId(item); try { await reloadPluginById({ body: { plugin_id: id } }); toast.success(e('messages.reloadSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.reloadFailed'))); } };
  const update = async (item: JsonObject) => { try { await updatePlugins({ body: { plugin_id: pluginId(item) } }); toast.success(e('messages.updateSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  const updateAll = async () => {
    if (updatingAll) return;
    const targets = pluginUpdateTargets(items);
    if (!targets.length) {
      toast.info(e('messages.noUpdatesAvailable'));
      return;
    }
    if (!await confirmAction({
      confirmLabel: e('dialogs.updateAllConfirm.confirm'),
      message: e('dialogs.updateAllConfirm.message', { count: targets.length }),
      title: e('dialogs.updateAllConfirm.title'),
    })) return;
    setUpdatingAll(true);
    setUpdateResult({ message: e('status.loading'), status: 'loading' });
    try {
      const response = await updatePlugins({ body: { plugin_ids: targets, proxy: getSelectedGitHubProxy() } });
      const { envelope, failures } = pluginBatchUpdateFailures(response);
      if (envelope.status === 'error') {
        setUpdateResult({ message: String(envelope.message || e('messages.updateAllFailed', { failed: targets.length, total: targets.length })), status: 'error' });
        return;
      }
      try {
        await load();
      } catch (cause) {
        failures.push({ name: 'refresh', status: 'error', message: errorMessage(cause, e('messages.refreshFailed')) });
      }
      if (failures.length) {
        const details = failures.map((failure) => `${String(failure.name || '')}: ${String(failure.message || e('messages.operationFailed'))}`).join('\n');
        setUpdateResult({ message: `${e('messages.updateAllFailed', { failed: failures.length, total: targets.length })}\n${details}`, status: 'error' });
      } else {
        setUpdateResult({ message: e('messages.updateAllSuccess'), status: 'success' });
        window.setTimeout(() => setUpdateResult(null), 2000);
      }
    } catch (cause) {
      setUpdateResult({ message: errorMessage(cause, e('messages.operationFailed')), status: 'error' });
    } finally {
      setUpdatingAll(false);
    }
  };
  const openConfig = async (item: JsonObject) => {
    const id = pluginId(item);
    setConfigPlugin(item); setConfig({}); setConfigMetadata(null); setConfigI18n({}); setConfigLoading(true);
    try {
      const payload = responseData<unknown>(await getPluginConfigById({ query: { plugin_id: id } }));
      if (isObject(payload)) {
        setConfig(isObject(payload.config) ? payload.config : {});
        setConfigMetadata(isObject(payload.metadata) ? payload.metadata : null);
        setConfigI18n(payload.i18n);
      }
    } catch (cause) {
      toast.error(errorMessage(cause, e('messages.operationFailed')));
    } finally {
      setConfigLoading(false);
    }
  };
  const saveConfig = async () => { if (!configPlugin) return; setSaving(true); try { await updatePluginConfigById({ body: { plugin_id: pluginId(configPlugin), config } }); toast.success(e('messages.saveSuccess')); setConfigPlugin(null); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } finally { setSaving(false); } };
  const uninstall = async () => { if (!uninstalling) return; try { await uninstallPluginById({ query: { plugin_id: pluginId(uninstalling) }, body: { delete_config: deleteConfig, delete_data: deleteData } }); toast.success(e('messages.deleteSuccess')); setUninstalling(null); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  const togglePin = (id: string) => { const next = pinned.includes(id) ? pinned.filter((name) => name !== id) : [id, ...pinned]; setPinned(next); localStorage.setItem(PINNED_KEY, JSON.stringify(next)); };
  const visible = useMemo(() => filterPlugins(items, search).sort((a, b) => {
    const ai = pinned.indexOf(pluginId(a)); const bi = pinned.indexOf(pluginId(b));
    if ((ai < 0 ? 9999 : ai) !== (bi < 0 ? 9999 : bi)) return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    if (Boolean(a.reserved) !== Boolean(b.reserved)) return Number(Boolean(a.reserved)) - Number(Boolean(b.reserved));
    return pluginTitle(a).localeCompare(pluginTitle(b));
  }), [items, pinned, search]);
  const viewDocs = async (item: JsonObject) => {
    setDocumentDialog({ item, content: '', error: '', loading: true });
    try {
      const response = await getPluginReadmeById({ query: { plugin_id: pluginId(item) } });
      const payload = responseData<unknown>(response);
      setDocumentDialog({ item, content: markdownContent(payload) || markdownContent(response.data), error: '', loading: false });
    } catch (cause) {
      setDocumentDialog({ item, content: '', error: errorMessage(cause, e('detail.docsEmpty')), loading: false });
    }
  };
  const openSourceBinding = async (item: JsonObject) => {
    const repo = pluginInstallUrl(item);
    setSourceBinding({ candidates: [], item, loading: true, saving: false, selected: '' });
    try {
      const sources = sourceList(responseData(await listPluginSources()));
      const candidates: JsonObject[] = [];
      for (const source of [{ name: e('market.defaultOfficialSource'), url: '' }, ...sources]) {
        try {
          const market = marketPluginList(responseData(await listPluginMarket({ query: { custom_registry: String(source.url || '') || undefined, page: 1, page_size: 100 } })));
          const match = market.find((candidate) => normalizePluginUrl(pluginInstallUrl(candidate)) === normalizePluginUrl(repo));
          if (match) candidates.push({
            key: `market:${String(source.url || 'official')}:${pluginId(match)}`,
            install_method: 'market', market_plugin_id: String(match.market_plugin_id || pluginId(match)),
            registry_name: String(source.name || e('market.defaultOfficialSource')), registry_url: String(source.url || '') || null,
          });
        } catch { /* An unavailable registry should not block the remaining candidates. */ }
      }
      if (repo) candidates.push({ key: `github:${normalizePluginUrl(repo)}`, install_method: 'github', registry_name: e('dialogs.sourceBinding.repoOption'), repo });
      setSourceBinding({ candidates, item, loading: false, saving: false, selected: String(candidates[0]?.key || '') });
    } catch (cause) {
      toast.error(errorMessage(cause, e('messages.operationFailed')));
      setSourceBinding({ candidates: repo ? [{ key: `github:${normalizePluginUrl(repo)}`, install_method: 'github', registry_name: e('dialogs.sourceBinding.repoOption'), repo }] : [], item, loading: false, saving: false, selected: repo ? `github:${normalizePluginUrl(repo)}` : '' });
    }
  };
  const saveSourceBinding = async () => {
    if (!sourceBinding) return;
    const candidate = sourceBinding.candidates.find((entry) => entry.key === sourceBinding.selected);
    if (!candidate) return;
    setSourceBinding({ ...sourceBinding, saving: true });
    try {
      await bindPluginSource({
        path: { plugin_id: pluginId(sourceBinding.item) },
        body: candidate.install_method === 'github'
          ? { install_method: 'github' }
          : { install_method: 'market', market_plugin_id: String(candidate.market_plugin_id || ''), registry_url: typeof candidate.registry_url === 'string' ? candidate.registry_url : null },
      });
      toast.success(e('messages.sourceBindSuccess')); setSourceBinding(null); await load();
    } catch (cause) {
      toast.error(errorMessage(cause, e('messages.operationFailed')));
      setSourceBinding({ ...sourceBinding, saving: false });
    }
  };
  const reloadFailed = async (item: JsonObject) => { const id = recordId(item, 'dir_name', 'name', 'id'); try { await reloadFailedPlugin({ path: { plugin_id: id } }); toast.success(e('messages.reloadSuccess')); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.reloadFailed'))); } };
  const removeFailed = async (item: JsonObject) => { const id = recordId(item, 'dir_name', 'name', 'id'); if (!await confirmAction({ danger: true, title: e('buttons.uninstall'), message: id })) return; try { await uninstallFailedPlugin({ path: { plugin_id: id } }); await load(); } catch (cause) { toast.error(errorMessage(cause, e('messages.operationFailed'))); } };
  return <section className="extension-section extension-installed">
    <header className="extension-installed__header">
      <h2>{e('titles.installedAstrBotPlugins')}</h2>
      <label className="extension-installed__search"><MdiIcon name="mdi-magnify" /><input onChange={(event) => setSearch(event.target.value)} placeholder={e('search.placeholder')} value={search} />{search && <button aria-label={e('buttons.close')} onClick={() => setSearch('')} type="button"><MdiIcon name="mdi-close" /></button>}</label>
    </header>
    {error && <div className="monitor-error">{error}</div>}
    {failed.length > 0 && <section className="extension-failed"><h3><MdiIcon name="mdi-alert-circle" />{e('failedPlugins.title', { count: failed.length })}</h3><p>{e('failedPlugins.hint')}</p>{failed.map((item) => { const id = recordId(item, 'dir_name', 'name', 'id'); return <article key={id}><div><strong>{String(item.display_name || id)}</strong><small>{id}</small></div><p>{String(item.error || e('status.unknown'))}</p><span><button onClick={() => void reloadFailed(item)} type="button"><MdiIcon name="mdi-refresh" />{e('buttons.reload')}</button><button className="button--danger" disabled={Boolean(item.reserved)} onClick={() => void removeFailed(item)} type="button"><MdiIcon name="mdi-delete" />{e('buttons.uninstall')}</button></span></article>; })}</section>}
    {loading ? <div className="extension-state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : <div className="extension-plugin-grid">{visible.map((item, index) => {
      const id = pluginId(item) || `plugin-${index}`; const pages = pluginPages(item); const enabled = (item.activated ?? item.enabled) !== false;
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : []; const platforms = Array.isArray(item.support_platforms) ? item.support_platforms.map(String) : [];
      const installSource = isObject(item.install_source) ? item.install_source : {};
      const installMethod = String(installSource.install_method || '').toLowerCase();
      const hasRepo = Boolean(pluginInstallUrl(item));
      const canUpdate = !item.reserved && (['market', 'github'].includes(installMethod) && installSource.implicit !== true || hasRepo);
      return <article className="extension-plugin-card" key={id} onClick={() => navigate(`/extension/${encodeURIComponent(id)}#installed`)}>
        <div className="extension-plugin-card__body">
          <div className="extension-plugin-card__logo"><MdiIcon name="mdi-puzzle" />{Boolean(item.logo) && <img alt="" onError={(event) => event.currentTarget.remove()} src={String(item.logo)} />}</div>
          <div className="extension-plugin-card__content">
            <header><div className="extension-plugin-card__title"><h3 title={localizedPluginTitle(item, i18n.language)}>{localizedPluginTitle(item, i18n.language)}</h3>{Boolean(item.version) && <span>{String(item.version)}</span>}{Boolean(item.reserved) && <span className="is-system">{e('status.system')}</span>}{Boolean(item.has_update) && <button aria-label={e('buttons.update')} className="extension-plugin-card__update" onClick={(event) => { event.stopPropagation(); void update(item); }} title={`${e('card.status.hasUpdate')}: ${String(item.online_version || '')}`} type="button"><MdiIcon name="mdi-update" /></button>}</div><label className="extension-plugin-switch" onClick={(event) => event.stopPropagation()} title={enabled ? e('buttons.disable') : e('buttons.enable')}><input checked={enabled} onChange={() => void toggle(item)} type="checkbox" /><span /></label></header>
            <div className="extension-plugin-card__chips">{Boolean(item.has_update) && <button className="is-update" onClick={(event) => { event.stopPropagation(); void update(item); }} type="button"><MdiIcon name="mdi-arrow-up-bold" />{String(item.online_version || '')}</button>}{tags.map((tag) => <span className={tag === 'danger' ? 'is-danger' : ''} key={tag}>{tag === 'danger' ? e('tags.danger') : tag}</span>)}{platforms.length > 0 && <span className="is-platform"><MdiIcon name="mdi-devices" />{platforms.join(', ')}</span>}{Boolean(item.astrbot_version) && <span className="is-version">AstrBot: {String(item.astrbot_version)}</span>}</div>
            <p>{localizedPluginDescription(item, i18n.language)}</p>
          </div>
        </div>
        <footer onClick={(event) => event.stopPropagation()}>
          <button aria-label={pinned.includes(id) ? e('buttons.unpin') : e('buttons.pin')} className={pinned.includes(id) ? 'is-active' : ''} onClick={() => togglePin(id)} title={pinned.includes(id) ? e('buttons.unpin') : e('buttons.pin')} type="button"><MdiIcon name={pinned.includes(id) ? 'mdi-pin' : 'mdi-pin-outline'} /></button>
          <button aria-label={e('buttons.viewDocs')} className="is-info" onClick={() => void viewDocs(item)} title={e('buttons.viewDocs')} type="button"><MdiIcon name="mdi-book-open-page-variant" /></button>
          {pages.length > 0 && <Link aria-label={e('buttons.openWebui')} className={!enabled ? 'is-disabled' : ''} onClick={(event) => !enabled && event.preventDefault()} title={e('buttons.openWebui')} to={`/plugin-page/${encodeURIComponent(id)}/${encodeURIComponent(pages[0])}`}><MdiIcon name="mdi-monitor-dashboard" /></Link>}
          <button aria-label={e('card.actions.pluginConfig')} onClick={() => void openConfig(item)} title={e('card.actions.pluginConfig')} type="button"><MdiIcon name="mdi-cog" /></button>
          <button aria-label={e('card.actions.reloadPlugin')} onClick={() => void reload(item)} title={e('card.actions.reloadPlugin')} type="button"><MdiIcon name="mdi-refresh" /></button>
          <details className="extension-plugin-card__menu"><summary aria-label={e('buttons.actions')} title={e('buttons.actions')}><MdiIcon name="mdi-dots-horizontal" /></summary><div><button onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); navigate(`/extension/${encodeURIComponent(id)}#plugin-components`); }} type="button"><MdiIcon name="mdi-information" />{e('buttons.viewInfo')}</button><button disabled={!canUpdate} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void update(item); }} title={!canUpdate ? e('messages.updateDisabled') : undefined} type="button"><MdiIcon name="mdi-update" />{item.has_update ? `${e('card.actions.updateTo')} ${String(item.online_version || '')}` : e('card.actions.reinstall')}</button><button disabled={!hasRepo} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void openSourceBinding(item); }} title={!hasRepo ? e('messages.changeSourceDisabled') : undefined} type="button"><MdiIcon name="mdi-source-branch" />{e('card.actions.changeSource')}</button><button className="button--danger" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setUninstalling(item); }} type="button"><MdiIcon name="mdi-delete" />{e('card.actions.uninstallPlugin')}</button></div></details>
        </footer>
      </article>;
    })}</div>}
    {!loading && !visible.length && <div className="extension-installed__empty"><MdiIcon name="mdi-puzzle-outline" /><h3>{e('empty.noPlugins')}</h3><p>{e('empty.noPluginsDesc')}</p></div>}
    {typeof document !== 'undefined' && createPortal(<div className="extension-installed__fabs"><button aria-label={e('buttons.updateAll')} disabled={loading || updatingAll} onClick={() => void updateAll()} title={e('buttons.updateAll')} type="button"><MdiIcon className={updatingAll ? 'mdi-spin' : undefined} name={updatingAll ? 'mdi-loading' : 'mdi-update'} /></button><button aria-label={e('market.installPlugin')} disabled={updatingAll} onClick={() => setInstallOpen(true)} title={e('market.installPlugin')} type="button"><MdiIcon name="mdi-plus" /></button></div>, document.body)}
    <Dialog onOpenChange={(open) => !open && setConfigPlugin(null)} open={configPlugin !== null} title={e('dialogs.config.title')}><div className="extension-plugin-config">{configLoading ? <div className="extension-state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : configPlugin && configMetadata && isObject(configMetadata[pluginId(configPlugin)]) ? <ConfigGroup fieldsFromValue metadata={configMetadata[pluginId(configPlugin)] as ConfigGroupMetadata} onChange={setConfig} pluginName={pluginId(configPlugin)} resolveText={(path, field, fallback) => localizedPluginConfigText(configI18n, i18n.language, path, field, fallback)} translationPath={pluginId(configPlugin)} value={config} /> : <p>{e('dialogs.config.noConfig')}</p>}</div><div className="dialog-actions"><button disabled={saving} onClick={() => void saveConfig()} type="button">{e('buttons.saveAndClose')}</button><button onClick={() => setConfigPlugin(null)} type="button">{e('buttons.close')}</button></div></Dialog>
    <InstallPluginDialog onInstalled={async (installed) => {
      await load();
      if (pluginId(installed)) await viewDocs(installed);
      try {
        const payload = responseData<unknown>(await listCommands());
        const summary = isObject(payload) && isObject(payload.summary) ? payload.summary : {};
        const conflicts = Number(summary.conflicts || 0);
        if (conflicts > 0 && await confirmAction({
          confirmLabel: e('conflicts.goToManage'),
          message: e('conflicts.message'),
          title: `${e('conflicts.title')} (${conflicts})`,
        })) navigate('/extension#components');
      } catch { /* Conflict discovery must not turn a successful install into an error. */ }
    }} onOpenChange={setInstallOpen} open={installOpen} />
    <Dialog onOpenChange={(open) => !open && updateResult?.status !== 'loading' && setUpdateResult(null)} open={updateResult !== null} title={e('dialogs.loading.title')}>
      <div className={`extension-update-result is-${updateResult?.status || 'loading'}`}>
        <MdiIcon className={updateResult?.status === 'loading' ? 'mdi-spin' : undefined} name={updateResult?.status === 'success' ? 'mdi-check-circle-outline' : updateResult?.status === 'error' ? 'mdi-alert-circle-outline' : 'mdi-loading'} />
        <p>{updateResult?.message}</p>
      </div>
      <div className="dialog-actions"><button disabled={updateResult?.status === 'loading'} onClick={() => setUpdateResult(null)} type="button">{e('buttons.close')}</button></div>
    </Dialog>
    <Dialog onOpenChange={(open) => !open && setDocumentDialog(null)} open={documentDialog !== null} title={t('core.common.readme.title')}><div className="extension-doc-dialog__toolbar">{Boolean(documentDialog?.item.repo) && <a href={String(documentDialog?.item.repo)} rel="noreferrer" target="_blank"><MdiIcon name="mdi-github" />{t('core.common.readme.buttons.viewOnGithub')}</a>}<button onClick={() => documentDialog && void viewDocs(documentDialog.item)} type="button"><MdiIcon name="mdi-refresh" />{t('core.common.readme.buttons.refresh')}</button></div><div className="extension-doc-dialog">{documentDialog?.loading ? <div className="extension-state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : documentDialog?.error ? <div className="extension-doc-dialog__state"><MdiIcon name="mdi-alert-circle-outline" /><p>{documentDialog.error}</p></div> : documentDialog?.content ? <Markdown content={documentDialog.content} /> : <div className="extension-doc-dialog__state"><MdiIcon name="mdi-file-question-outline" /><p>{e('detail.docsEmpty')}</p></div>}</div><div className="dialog-actions"><button onClick={() => setDocumentDialog(null)} type="button">{e('buttons.close')}</button></div></Dialog>
    <Dialog onOpenChange={(open) => !open && setSourceBinding(null)} open={sourceBinding !== null} title={e('dialogs.sourceBinding.title')}><div className="extension-source-binding">{sourceBinding?.loading ? <div className="extension-state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : !sourceBinding?.candidates.length ? <div className="extension-source-binding__empty">{e('dialogs.sourceBinding.noCandidates')}</div> : sourceBinding.candidates.map((candidate) => <label key={String(candidate.key)}><input checked={sourceBinding.selected === candidate.key} name="plugin-source" onChange={() => setSourceBinding({ ...sourceBinding, selected: String(candidate.key) })} type="radio" /><span><strong>{String(candidate.registry_name)}</strong>{Boolean(candidate.repo) && <small>{String(candidate.repo)}</small>}</span></label>)}</div><div className="dialog-actions"><button onClick={() => setSourceBinding(null)} type="button">{e('buttons.cancel')}</button><button className="button--primary" disabled={!sourceBinding?.selected || sourceBinding?.saving} onClick={() => void saveSourceBinding()} type="button">{e('dialogs.sourceBinding.confirm')}</button></div></Dialog>
    <Dialog onOpenChange={(open) => !open && setUninstalling(null)} open={uninstalling !== null} title={e('dialogs.uninstall.title')}><div className="extension-uninstall"><p>{e('dialogs.uninstall.message')}</p><label><input checked={deleteConfig} onChange={(event) => setDeleteConfig(event.target.checked)} type="checkbox" />{e('dialogs.uninstall.deleteConfig')}<small>{e('dialogs.uninstall.configHint')}</small></label><label><input checked={deleteData} onChange={(event) => setDeleteData(event.target.checked)} type="checkbox" />{e('dialogs.uninstall.deleteData')}<small>{e('dialogs.uninstall.dataHint')}</small></label></div><div className="dialog-actions"><button onClick={() => setUninstalling(null)} type="button">{e('buttons.cancel')}</button><button className="button--danger" onClick={() => void uninstall()} type="button">{e('buttons.uninstall')}</button></div></Dialog>
  </section>;
}

function PluginMarket() {
  const { t } = useTranslation(); const navigate = useNavigate(); const e = (key: string, options?: Record<string, unknown>) => t(`features.extension.${key}`, options);
  const [items, setItems] = useState<JsonObject[]>([]); const [sources, setSources] = useState<JsonObject[]>([]);
  const [selectedSource, setSelectedSource] = useState(() => localStorage.getItem('selectedPluginSource') || '');
  const [keyword, setKeyword] = useState(''); const [debouncedKeyword, setDebouncedKeyword] = useState(''); const [category, setCategory] = useState('all'); const [sort, setSort] = useState<'default' | 'stars' | 'author' | 'updated'>('default'); const [order, setOrder] = useState<'asc' | 'desc'>('desc'); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState(''); const [installing, setInstalling] = useState<JsonObject | null>(null); const [danger, setDanger] = useState<JsonObject | null>(null); const [randomNames, setRandomNames] = useState<string[]>([]);
  const [sourceManager, setSourceManager] = useState(false); const [sourceEditor, setSourceEditor] = useState<{ editingUrl: string; meta: JsonObject | null; name: string; resolved: boolean; resolving: boolean; url: string } | null>(null);
  const compatibilityCache = useRef(new Map<string, { message: string; supported: boolean }>());
  const loadSources = useCallback(async () => { try { setSources(sourceList(responseData(await listPluginSources()))); } catch { setSources([]); } }, []);
  const shuffle = useCallback((plugins: JsonObject[]) => {
    const copy = [...plugins]; for (let index = copy.length - 1; index > 0; index -= 1) { const target = Math.floor(Math.random() * (index + 1)); [copy[index], copy[target]] = [copy[target], copy[index]]; }
    setRandomNames(copy.slice(0, 3).map(pluginId));
  }, []);
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true); setError('');
    try {
      const [marketResponse, installedResponse] = await Promise.all([
        listPluginMarket({ query: { custom_registry: selectedSource || undefined, force_refresh: refresh, page: 1, page_size: 1000 } }),
        listPlugins({ query: { include_reserved: true } }).catch(() => null),
      ]);
      const market = marketPluginList(responseData(marketResponse));
      const marked = markInstalledMarketPlugins(market, pluginList(responseData(installedResponse)), selectedSource);
      const specs = Array.from(new Set(marked.map((item) => String(item.astrbot_version || '')).filter(Boolean)));
      await Promise.all(specs.map(async (spec) => {
        if (compatibilityCache.current.has(spec)) return;
        try { const payload = responseData<unknown>(await checkPluginVersionSupport({ body: { astrbot_version: spec } })); const data = isObject(payload) ? payload : {}; compatibilityCache.current.set(spec, { message: String(data.message || data.reason || ''), supported: data.supported !== false }); }
        catch { compatibilityCache.current.set(spec, { message: '', supported: true }); }
      }));
      const annotated = marked.map((item) => { const result = compatibilityCache.current.get(String(item.astrbot_version || '')); return result ? { ...item, astrbot_support_message: result.message, astrbot_version_supported: result.supported } : item; });
      const searchable = await addPluginPinyinSearchIndex(annotated);
      setItems(searchable); shuffle(searchable);
    } catch (cause) { setError(errorMessage(cause, e('messages.getMarketDataFailed'))); } finally { setLoading(false); setRefreshing(false); }
  }, [selectedSource, shuffle, t]);
  useEffect(() => { void loadSources(); }, [loadSources]); useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedKeyword(keyword); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [keyword]);
  const counts = useMemo(() => marketCategoryCounts(items), [items]);
  const categories = useMemo(() => Array.from(counts.entries()).map(([value, count]) => {
    const translated = e(`market.categories.${value}`); const key = `features.extension.market.categories.${value}`;
    const raw = items.find((item) => normalizeMarketCategory(categoryValue(item)) === value);
    return { count, label: translated === key ? String(raw ? categoryValue(raw) : value) : translated, value };
  }), [counts, items, t]);
  useEffect(() => { if (!counts.has(category)) setCategory('all'); }, [category, counts]);
  const filtered = useMemo(() => filterPlugins(items, debouncedKeyword).filter((item) => category === 'all' || normalizeMarketCategory(categoryValue(item)) === category), [category, debouncedKeyword, items]);
  const sorted = useMemo(() => sortMarketPlugins(filtered, sort, order), [filtered, order, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / 9)); const visible = sorted.slice((page - 1) * 9, page * 9);
  const randomPlugins = randomNames.map((name) => items.find((item) => pluginId(item) === name)).filter(isObject);
  const currentSourceName = selectedSource ? String(sources.find((source) => String(source.url || '') === selectedSource)?.name || e('market.defaultSource')) : e('market.defaultSource');
  const chooseSource = (url: string) => { setSelectedSource(url); setPage(1); if (url) localStorage.setItem('selectedPluginSource', url); else localStorage.removeItem('selectedPluginSource'); };
  const persistSources = async (next: JsonObject[]) => { await replacePluginSources({ body: { sources: next.map((source) => ({ id: typeof source.id === 'string' ? source.id : undefined, name: String(source.name || ''), url: String(source.url || '') })) } }); setSources(next); };
  const removeSource = async (source: JsonObject) => {
    if (!await confirmAction({ danger: true, title: e('market.removeSource'), message: `${e('market.confirmRemoveSource')}\n${String(source.name || '')}\n${String(source.url || '')}` })) return;
    try { const next = sources.filter((item) => String(item.url || '') !== String(source.url || '')); await persistSources(next); if (selectedSource === String(source.url || '')) chooseSource(''); toast.success(e('market.sourceRemoved')); } catch (cause) { toast.error(errorMessage(cause, e('market.sourceError'))); }
  };
  const resolveSource = async () => {
    if (!sourceEditor) return; const url = sourceEditor.url.trim();
    try { new URL(url); } catch { toast.error(e('messages.invalidUrl')); return; }
    if (sources.some((source) => normalizePluginUrl(source.url) === normalizePluginUrl(url) && normalizePluginUrl(source.url) !== normalizePluginUrl(sourceEditor.editingUrl))) { toast.error(e('market.sourceExists')); return; }
    setSourceEditor({ ...sourceEditor, resolving: true });
    try { const payload = responseData<unknown>(await listPluginMarket({ query: { custom_registry: url, force_refresh: true, page: 1, page_size: 1 } })); const meta = isObject(payload) && isObject(payload.$meta) ? payload.$meta : null; setSourceEditor({ ...sourceEditor, meta, name: sourceEditor.name.trim() || String(meta?.name || ''), resolved: true, resolving: false, url }); toast.success(e('market.sourceResolved')); }
    catch (cause) { setSourceEditor({ ...sourceEditor, resolving: false }); toast.error(errorMessage(cause, e('messages.sourceResolveFailed'))); }
  };
  const saveSource = async () => {
    if (!sourceEditor?.resolved) { toast.warning(e('messages.resolveSourceFirst')); return; } if (!sourceEditor.name.trim()) { toast.warning(e('messages.fillSourceName')); return; }
    const entry = { name: sourceEditor.name.trim(), url: sourceEditor.url.trim() };
    const next = sourceEditor.editingUrl ? sources.map((source) => String(source.url || '') === sourceEditor.editingUrl ? { ...source, ...entry } : source) : [...sources, entry];
    try { await persistSources(next); if (selectedSource === sourceEditor.editingUrl) chooseSource(entry.url); toast.success(e(sourceEditor.editingUrl ? 'market.sourceUpdated' : 'market.sourceAdded')); setSourceEditor(null); } catch (cause) { toast.error(errorMessage(cause, e('market.sourceError'))); }
  };
  const requestInstall = (item: JsonObject) => { if (Array.isArray(item.tags) && item.tags.includes('danger')) setDanger(item); else setInstalling(item); };
  return <section className="extension-section extension-market">
    <header className="extension-market__header"><div><div><h2>{e('tabs.market')}</h2><button onClick={() => setSourceManager(true)} title={e('market.sourceManagement')} type="button"><MdiIcon name="mdi-source-branch" /><span>{currentSourceName}</span></button></div><p><MdiIcon name="mdi-alert-outline" />{e('market.sourceSafetyWarning')}</p></div><label><MdiIcon name="mdi-magnify" /><input onChange={(event) => setKeyword(event.target.value)} placeholder={e('search.marketPlaceholder')} value={keyword} />{keyword && <button aria-label={e('buttons.close')} onClick={() => setKeyword('')} type="button"><MdiIcon name="mdi-close" /></button>}</label></header>
    <button aria-label={e('market.installPlugin')} className="extension-market__fab" onClick={() => setInstalling({})} title={e('market.installPlugin')} type="button"><MdiIcon name="mdi-plus" /></button>
    <div className="extension-market__section-title"><div><h2>{e('market.allPlugins')}</h2><button aria-label={e('buttons.refresh')} disabled={loading || refreshing} onClick={() => void load(true)} title={e('buttons.refresh')} type="button"><MdiIcon className={refreshing ? 'mdi-spin' : undefined} name="mdi-refresh" /></button></div><div><label><span>{e('market.category')}</span><select onChange={(event) => { setCategory(event.target.value); setPage(1); }} value={category}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></label><label><MdiIcon name="mdi-sort" /><span>{e('sort.by')}</span><select onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} value={sort}><option value="default">{e('sort.default')}</option><option value="stars">{e('sort.stars')}</option><option value="author">{e('sort.author')}</option><option value="updated">{e('sort.updated')}</option></select></label>{sort !== 'default' && <button aria-label={order === 'desc' ? e('sort.descending') : e('sort.ascending')} onClick={() => setOrder((value) => value === 'desc' ? 'asc' : 'desc')} title={order === 'desc' ? e('sort.descending') : e('sort.ascending')} type="button"><MdiIcon name={order === 'desc' ? 'mdi-arrow-down-thin' : 'mdi-arrow-up-thin'} /></button>}</div></div>
    {error && <div className="monitor-error">{error}</div>}{loading ? <div className="extension-state"><MdiIcon className="mdi-spin" name="mdi-loading" /></div> : <div className="extension-market-grid">{visible.map((item, index) => <MarketPluginCard item={item} key={pluginId(item) || index} onInstall={requestInstall} onOpen={(plugin) => navigate(`/extension/${encodeURIComponent(pluginId(plugin))}#market`)} t={e} />)}</div>}
    {!loading && !visible.length && <div className="monitor-empty">{e('empty.noPlugins')}</div>}
    {pages > 1 && <div className="extension-market__pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button"><MdiIcon name="mdi-chevron-left" /></button>{Array.from({ length: pages }, (_, index) => index + 1).slice(Math.max(0, page - 4), Math.max(7, page + 3)).map((number) => <button aria-current={number === page ? 'page' : undefined} key={number} onClick={() => setPage(number)} type="button">{number}</button>)}<button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} type="button"><MdiIcon name="mdi-chevron-right" /></button></div>}
    {randomPlugins.length > 0 && <section className="extension-market__random"><header><h2>{e('market.randomPlugins')}</h2><button disabled={!items.length} onClick={() => shuffle(items)} type="button"><MdiIcon name="mdi-shuffle-variant" />{e('buttons.reshuffle')}</button></header><div className="extension-market-grid">{randomPlugins.map((item, index) => <MarketPluginCard item={item} key={`random-${pluginId(item) || index}`} onInstall={requestInstall} onOpen={(plugin) => navigate(`/extension/${encodeURIComponent(pluginId(plugin))}#market`)} t={e} />)}</div></section>}
    <InstallPluginDialog initial={pluginId(installing || {}) ? installing || undefined : undefined} onInstalled={() => void load(true)} onOpenChange={(open) => !open && setInstalling(null)} open={installing !== null} registryUrl={selectedSource} />
    <Dialog onOpenChange={(open) => !open && setDanger(null)} open={danger !== null} title={e('dialogs.danger_warning.title')}><div className="extension-warning"><MdiIcon name="mdi-alert-circle" />{e('dialogs.danger_warning.message')}</div><div className="dialog-actions"><button onClick={() => setDanger(null)} type="button">{e('dialogs.danger_warning.cancel')}</button><button className="button--warning" onClick={() => { setInstalling(danger); setDanger(null); }} type="button">{e('dialogs.danger_warning.confirm')}</button></div></Dialog>
    <Dialog onOpenChange={setSourceManager} open={sourceManager} title={e('market.sourceManagement')}><div className="extension-source-list"><header><strong>{e('market.availableSources')}</strong><button onClick={() => { setSourceManager(false); setSourceEditor({ editingUrl: '', meta: null, name: '', resolved: false, resolving: false, url: '' }); }} type="button"><MdiIcon name="mdi-plus" />{e('market.addSource')}</button></header><button className={!selectedSource ? 'is-active' : ''} onClick={() => chooseSource('')} type="button"><MdiIcon name="mdi-shield-check" /><span><strong>{e('market.defaultSource')}</strong></span></button>{sources.map((source, index) => <article className={selectedSource === String(source.url || '') ? 'is-active' : ''} key={recordId(source, 'id') || String(source.url || index)} onClick={() => chooseSource(String(source.url || ''))}><MdiIcon name="mdi-link-variant" /><span><strong>{String(source.name || source.url)}</strong><small>{String(source.url || '')}</small></span><button aria-label={e('market.editSource')} onClick={(event) => { event.stopPropagation(); setSourceManager(false); setSourceEditor({ editingUrl: String(source.url || ''), meta: null, name: String(source.name || ''), resolved: true, resolving: false, url: String(source.url || '') }); }} type="button"><MdiIcon name="mdi-pencil-outline" /></button><button aria-label={e('buttons.deleteSource')} onClick={(event) => { event.stopPropagation(); void removeSource(source); }} type="button"><MdiIcon name="mdi-trash-can-outline" /></button></article>)}</div><div className="dialog-actions"><button onClick={() => setSourceManager(false)} type="button">{e('buttons.close')}</button></div></Dialog>
    <Dialog onOpenChange={(open) => !open && setSourceEditor(null)} open={sourceEditor !== null} title={e(sourceEditor?.editingUrl ? 'market.editSource' : 'market.addSource')}><div className="extension-source-editor"><label>{e('market.sourceUrl')}<input onChange={(event) => sourceEditor && setSourceEditor({ ...sourceEditor, meta: null, resolved: false, url: event.target.value })} placeholder="https://example.com/plugins.json" value={sourceEditor?.url || ''} /><small>{e('messages.enterJsonUrl')}</small></label>{sourceEditor?.resolved && <div className="extension-validation is-valid"><MdiIcon name="mdi-check-circle" /><span>{e('market.sourceResolved')}{sourceEditor.meta && <small>{String(sourceEditor.meta.name || '')} {sourceEditor.meta.version ? `v${String(sourceEditor.meta.version)}` : ''}</small>}</span></div>}{(sourceEditor?.editingUrl || sourceEditor?.resolved) && <label>{e('market.sourceName')}<input onChange={(event) => sourceEditor && setSourceEditor({ ...sourceEditor, name: event.target.value })} placeholder={e('market.sourceName')} value={sourceEditor?.name || ''} /></label>}</div><div className="dialog-actions"><button onClick={() => setSourceEditor(null)} type="button">{e('buttons.cancel')}</button><button className="button--primary" disabled={sourceEditor?.resolving} onClick={() => void (sourceEditor?.resolved ? saveSource() : resolveSource())} type="button">{sourceEditor?.resolving ? e('status.loading') : e(sourceEditor?.resolved ? 'buttons.save' : 'buttons.next')}</button></div></Dialog>
  </section>;
}

function MarketPluginCard({ item, onInstall, onOpen, t }: { item: JsonObject; onInstall: (item: JsonObject) => void; onOpen: (item: JsonObject) => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  const { i18n } = useTranslation(); const platforms = Array.isArray(item.support_platforms) ? item.support_platforms.map(String) : []; const canInstall = Boolean(item.market_plugin_id); const localizedTitle = localizedPluginTitle(item, i18n.language); const title = localizedTitle === pluginTitle(item) ? marketPluginDisplayName(item) : localizedTitle; const description = localizedPluginDescription(item, i18n.language) || String(item.short_desc || pluginDescription(item));
  return <article className="extension-market-card" onClick={() => onOpen(item)}>
    <div className="extension-market-card__body">{Boolean(item.logo) ? <img alt="" onError={(event) => event.currentTarget.remove()} src={String(item.logo)} /> : <div className="extension-market-card__fallback"><MdiIcon name="mdi-puzzle" /></div>}<div><header><h3 title={title}>{title}</h3>{Boolean(item.pinned) && <span className="is-recommended">{t('market.recommended')}</span>}{item.astrbot_version_supported === false && <span className="is-unsupported">{t('status.unsupported')}</span>}</header><div className="extension-market-card__meta"><MdiIcon name="mdi-account" />{Boolean(item.social_link) ? <a href={String(item.social_link)} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">{pluginAuthor(item)}</a> : <strong>{pluginAuthor(item)}</strong>}{item.stars !== undefined && <span><MdiIcon name="mdi-star" />{String(item.stars)}</span>}{item.download_count !== undefined && item.download_count !== null && <span><MdiIcon name="mdi-download" />{String(item.download_count)}</span>}</div><p title={description}>{description}</p></div></div>
    <footer onClick={(event) => event.stopPropagation()}>{platforms.length > 0 && <span className="extension-market-card__platforms"><MdiIcon name="mdi-devices" />{platforms.join(', ')}</span>}<div className="extension-market-card__actions">{Boolean(item.repo) && <a href={String(item.repo)} rel="noreferrer" target="_blank"><MdiIcon name="mdi-github" />{t('buttons.viewRepo')}</a>}{Boolean(item.installed) ? <button className="is-installed" disabled type="button">✓ {t('status.installed')}</button> : <button className="button--primary" disabled={!canInstall} onClick={() => onInstall(item)} title={!canInstall ? t('messages.missingMarketPluginId') : undefined} type="button">{t('buttons.install')}</button>}</div></footer>
  </article>;
}
