import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  getPluginById,
  getPluginChangelogById,
  getPluginConfigById,
  getPluginReadmeById,
  listPluginMarket,
  listPluginPagesById,
  reloadPluginById,
  uninstallPluginById,
  updatePluginConfigById,
  updatePlugins,
} from '@/api/openapi';
import { type PluginDto, parsePlugin } from '@/api/domain';
import { decodeApiData } from '@/api/response';
import { Markdown } from '@/components/content/Markdown';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { selectedPluginSourcePreference } from '@/config/preferences';
import { confirmAction, toast } from '@/stores/feedback';
import {
  errorMessage,
  isObject,
  type JsonObject,
  objectList,
  parseJsonObject,
  prettyJson,
  recordId,
  responseData,
} from '@/routes/configuration/model';
import {
  categoryValue,
  markdownContent,
  marketPluginList,
  normalizePluginUrl,
  pluginAuthor,
  pluginDescription,
  pluginId,
  pluginTitle,
} from './extensionModel';
import { InstallPluginDialog } from './PluginInstallDialog';

function pluginComponents(plugin: PluginDto): JsonObject[] {
  const components = plugin.components;
  if (Array.isArray(components)) return components.filter(isObject);
  if (isObject(components))
    return ['page', 'skill', 'command', 'llm_tool', 'listener', 'hook'].flatMap((key) => {
      const group = components[key];
      return Array.isArray(group) ? group.filter(isObject).map((item) => ({ ...item, component_type: key })) : [];
    });
  for (const key of ['handlers', 'command_handlers', 'commands']) {
    const group = plugin[key];
    if (!Array.isArray(group)) continue;
    return group.map((item) => (typeof item === 'string' ? { cmd: item, type: 'command' } : item)).filter(isObject);
  }
  return [];
}

export function PluginDetail({ pluginId: id, source }: { pluginId: string; source: 'installed' | 'market' }) {
  const { t } = useTranslation();
  const e = (key: string) => t(`features.extension.${key}`);
  const navigate = useNavigate();
  const location = useLocation();
  const [plugin, setPlugin] = useState<PluginDto>({});
  const [pages, setPages] = useState<JsonObject[]>([]);
  const [config, setConfig] = useState('{}');
  const [savedConfig, setSavedConfig] = useState('{}');
  const [readme, setReadme] = useState('');
  const [changelog, setChangelog] = useState('');
  const [tab, setTab] = useState<'overview' | 'config' | 'readme' | 'changelog'>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);
  const components = useMemo(() => pluginComponents(plugin), [plugin]);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (source === 'market') {
        const registry = selectedPluginSourcePreference.read() || undefined;
        const market = marketPluginList(
          responseData(
            await listPluginMarket({ query: { custom_registry: registry, keyword: id, page: 1, page_size: 1000 } }),
          ),
        );
        const found = market.find(
          (item) => pluginId(item) === id || normalizePluginUrl(item.repo) === normalizePluginUrl(id),
        );
        if (!found) throw new Error(e('detail.notFound'));
        setPlugin(found);
        return;
      }
      const [detailResponse, configResponse, pageResponse] = await Promise.all([
        getPluginById({ query: { plugin_id: id } }),
        getPluginConfigById({ query: { plugin_id: id } }).catch(() => null),
        listPluginPagesById({ query: { plugin_id: id } }).catch(() => null),
      ]);
      setPlugin(decodeApiData(detailResponse, parsePlugin, 'plugin detail'));
      const configData = responseData<JsonObject>(configResponse);
      const text = prettyJson(isObject(configData?.config) ? configData.config : {});
      setConfig(text);
      setSavedConfig(text);
      setPages(objectList(responseData(pageResponse), ['pages', 'items']));
    } catch (cause) {
      setError(errorMessage(cause, e('detail.notFound')));
    } finally {
      setLoading(false);
    }
  }, [id, source, t]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!loading && location.hash === '#plugin-components')
      window.setTimeout(
        () => document.getElementById('plugin-components')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        0,
      );
  }, [loading, location.hash]);
  useEffect(() => {
    if (source !== 'installed') return;
    if (tab === 'readme' && !readme)
      void getPluginReadmeById({ query: { plugin_id: id } })
        .then((response) => setReadme(markdownContent(responseData(response)) || markdownContent(response.data)))
        .catch(() => setReadme(''));
    if (tab === 'changelog' && !changelog)
      void getPluginChangelogById({ query: { plugin_id: id } })
        .then((response) => setChangelog(markdownContent(responseData(response)) || markdownContent(response.data)))
        .catch(() => setChangelog(''));
  }, [changelog, id, readme, source, tab]);
  const save = async () => {
    let value: JsonObject;
    try {
      value = parseJsonObject(config);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Invalid JSON'));
      return;
    }
    setSaving(true);
    try {
      await updatePluginConfigById({ body: { plugin_id: id, config: value } });
      setSavedConfig(prettyJson(value));
      toast.success(e('messages.saveSuccess'));
    } catch (cause) {
      toast.error(errorMessage(cause, e('messages.operationFailed')));
    } finally {
      setSaving(false);
    }
  };
  const action = async (kind: 'reload' | 'update' | 'uninstall') => {
    try {
      if (kind === 'reload') await reloadPluginById({ body: { plugin_id: id } });
      if (kind === 'update') await updatePlugins({ body: { plugin_id: id } });
      if (kind === 'uninstall') {
        if (!(await confirmAction({ danger: true, title: e('buttons.uninstall'), message: pluginTitle(plugin) })))
          return;
        await uninstallPluginById({ query: { plugin_id: id } });
        void navigate('/extension#installed');
        return;
      }
      toast.success(e(kind === 'reload' ? 'messages.reloadSuccess' : 'messages.updateSuccess'));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, e('messages.operationFailed')));
    }
  };
  return (
    <div className="extension-page extension-detail">
      <header className="extension-detail__breadcrumb">
        <button onClick={() => navigate(`/extension#${source}`)} type="button">
          <MdiIcon name="mdi-arrow-left" />
        </button>
        <span>{e(source === 'market' ? 'tabs.market' : 'titles.installedAstrBotPlugins')}</span>
        <MdiIcon name="mdi-chevron-right" />
        <strong>{pluginTitle(plugin)}</strong>
      </header>
      {error && <div className="monitor-error">{error}</div>}
      {loading ? (
        <div className="extension-state">
          <MdiIcon className="mdi-spin" name="mdi-loading" />
        </div>
      ) : (
        <>
          <section className="extension-detail__summary">
            {plugin.logo ? <img alt="" src={String(plugin.logo)} /> : <MdiIcon name="mdi-puzzle" />}
            <div>
              <h1>{pluginTitle(plugin)}</h1>
              <p>{pluginDescription(plugin)}</p>
              <div>
                <span>{pluginAuthor(plugin) || '—'}</span>
                <span>{String(plugin.version || '—')}</span>
              </div>
            </div>
            <aside>
              {source === 'market' ? (
                <button className="button--primary" onClick={() => setInstalling(true)} type="button">
                  {e('buttons.install')}
                </button>
              ) : (
                <>
                  <button onClick={() => void action('reload')} type="button">
                    {e('buttons.reload')}
                  </button>
                  <button onClick={() => void action('update')} type="button">
                    {e('buttons.update')}
                  </button>
                  {!plugin.reserved && (
                    <button className="button--danger" onClick={() => void action('uninstall')} type="button">
                      {e('buttons.uninstall')}
                    </button>
                  )}
                </>
              )}
            </aside>
          </section>
          {source === 'installed' && (
            <nav className="extension-subtabs">
              {(['overview', 'config', 'readme', 'changelog'] as const).map((name) => (
                <button aria-pressed={tab === name} key={name} onClick={() => setTab(name)} type="button">
                  {name === 'overview'
                    ? e('buttons.viewInfo')
                    : name === 'config'
                      ? e('buttons.configure')
                      : name === 'readme'
                        ? e('detail.docsTitle')
                        : e('detail.changelogTitle')}
                </button>
              ))}
            </nav>
          )}
          {(source === 'market' || tab === 'overview') && (
            <>
              <section className="extension-detail__info">
                <h2>{e('detail.info.title')}</h2>
                <dl>
                  <dt>{e('detail.info.version')}</dt>
                  <dd>{String(plugin.version || '—')}</dd>
                  <dt>{e('detail.info.author')}</dt>
                  <dd>{pluginAuthor(plugin) || '—'}</dd>
                  <dt>{e('detail.info.category')}</dt>
                  <dd>{categoryValue(plugin)}</dd>
                  <dt>{e('detail.info.stars')}</dt>
                  <dd>{String(plugin.stars || 0)}</dd>
                  <dt>{e('detail.info.astrbotVersion')}</dt>
                  <dd>{String(plugin.astrbot_version || plugin.astrbot_version_requirement || '—')}</dd>
                  <dt>{e('detail.info.repository')}</dt>
                  <dd>
                    {plugin.repo || plugin.repo_url ? (
                      <a href={String(plugin.repo || plugin.repo_url)} rel="noreferrer" target="_blank">
                        {String(plugin.repo || plugin.repo_url)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </dl>
                {pages.length > 0 && (
                  <div className="extension-detail__pages">
                    <h2>{e('buttons.openPages')}</h2>
                    {pages.map((page, index) => {
                      const name = recordId(page, 'name', 'page_name', 'id') || `page-${index}`;
                      return (
                        <Link key={name} to={`/plugin-page/${encodeURIComponent(id)}/${encodeURIComponent(name)}`}>
                          {String(page.title || page.display_name || name)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="extension-detail__components" id="plugin-components">
                <h2>{e('detail.contents')}</h2>
                {components.length ? (
                  <div>
                    {components.map((component, index) => (
                      <article key={recordId(component, 'handler_full_name', 'name', 'cmd', 'handler_name') || index}>
                        <MdiIcon
                          name={
                            String(component.component_type || component.type).includes('page')
                              ? 'mdi-monitor-dashboard'
                              : String(component.component_type || component.type).includes('tool')
                                ? 'mdi-tools'
                                : 'mdi-console-line'
                          }
                        />
                        <span>
                          <strong>
                            {String(component.name || component.cmd || component.handler_name || e('status.unknown'))}
                          </strong>
                          <small>
                            {String(
                              component.description ||
                                component.desc ||
                                component.event_type_h ||
                                component.event_type ||
                                '',
                            )}
                          </small>
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>{e('detail.noContents')}</p>
                )}
              </section>
            </>
          )}
          {tab === 'config' && source === 'installed' && (
            <section className="extension-config-editor extension-config-editor--detail">
              <MonacoEditor language="json" onChange={setConfig} value={config} />
              <div>
                <button disabled={config === savedConfig} onClick={() => setConfig(savedConfig)} type="button">
                  {e('buttons.cancel')}
                </button>
                <button
                  className="button--primary"
                  disabled={saving || config === savedConfig}
                  onClick={() => void save()}
                  type="button"
                >
                  {e('buttons.save')}
                </button>
              </div>
            </section>
          )}
          {tab === 'readme' && (
            <section className="extension-markdown">
              <Markdown content={readme || e('detail.docsEmpty')} />
            </section>
          )}
          {tab === 'changelog' && (
            <section className="extension-markdown">
              <Markdown content={changelog || e('detail.changelogEmpty')} />
            </section>
          )}
        </>
      )}
      <InstallPluginDialog
        initial={plugin}
        onInstalled={() => navigate('/extension#installed')}
        onOpenChange={setInstalling}
        open={installing}
        registryUrl={source === 'market' ? selectedPluginSourcePreference.read() : ''}
      />
    </div>
  );
}
