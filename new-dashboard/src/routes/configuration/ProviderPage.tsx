import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createProvider,
  createProviderInSourceById,
  createProviderSource,
  deleteProviderById,
  deleteProviderSourceById,
  getProviderSchema,
  listProviderSourceModelsById,
  listProviders,
  setProviderEnabledById,
  testProviderById,
  updateProviderById,
  upsertProviderSourceById,
} from '@/api/openapi';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { JsonConfigDialog, LoadingState } from './ConfigurationUi';
import { errorMessage, isObject, JsonObject, objectList, parseJsonObject, prettyJson, recordId, responseData } from './model';
import {
  buildModelProvider,
  capabilityBadges,
  formatContextLimit,
  PROVIDER_TABS,
  providerSchemaData,
  recordsForType,
  sourceFromTemplate,
  sourceTemplatesForType,
  type ProviderType,
} from './providerPageModel';

type AvailableModel = { metadata?: JsonObject; name: string };

export default function ProviderPage() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<JsonObject[]>([]);
  const [providerSources, setProviderSources] = useState<JsonObject[]>([]);
  const [providerTemplates, setProviderTemplates] = useState<JsonObject>({});
  const [modelMetadata, setModelMetadata] = useState<JsonObject>({});
  const [activeType, setActiveType] = useState<ProviderType>('chat_completion');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [editableSource, setEditableSource] = useState<JsonObject | null>(null);
  const [sourceOriginalId, setSourceOriginalId] = useState('');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableMetadata, setAvailableMetadata] = useState<JsonObject>({});
  const [modelSearch, setModelSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<JsonObject | null>(null);
  const [providerJson, setProviderJson] = useState('{}');
  const [editingSourceDialog, setEditingSourceDialog] = useState<JsonObject | null>(null);
  const [sourceDialogOriginalId, setSourceDialogOriginalId] = useState('');
  const [sourceJson, setSourceJson] = useState('{}');

  const load = useCallback(async (preferredSourceId = '') => {
    setLoading(true);
    setError('');
    try {
      const payload = responseData<JsonObject>(await getProviderSchema());
      if (!isObject(payload)) throw new Error('Invalid provider schema response.');
      const data = providerSchemaData(payload);
      setProviders(data.providers);
      setProviderSources(data.providerSources);
      setProviderTemplates(data.templates);
      setModelMetadata(data.modelMetadata);
      setSelectedSourceId((current) => {
        const candidate = preferredSourceId || current;
        return data.providerSources.some((source) => recordId(source, 'id') === candidate) ? candidate : '';
      });
    } catch (schemaError) {
      try {
        const fallback = objectList(responseData(await listProviders()), ['providers', 'data']);
        setProviders(fallback);
        setProviderSources([]);
        setProviderTemplates({});
        setModelMetadata({});
        setSelectedSourceId('');
      } catch {
        setError(errorMessage(schemaError, 'Failed to load providers.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSource = useMemo(
    () => providerSources.find((source) => recordId(source, 'id') === selectedSourceId) ?? null,
    [providerSources, selectedSourceId],
  );

  useEffect(() => {
    setEditableSource(selectedSource ? cloneObject(selectedSource) : null);
    setSourceOriginalId(selectedSource ? recordId(selectedSource, 'id') : '');
    setAvailableModels([]);
    setAvailableMetadata({});
    setModelSearch('');
  }, [selectedSource]);

  const activeTab = PROVIDER_TABS.find((tab) => tab.type === activeType) ?? PROVIDER_TABS[0];
  const visibleSources = useMemo(() => recordsForType(providerSources, activeType), [activeType, providerSources]);
  const visibleProviders = useMemo(() => recordsForType(providers, activeType), [activeType, providers]);
  const templateOptions = useMemo(() => sourceTemplatesForType(providerTemplates, activeType), [activeType, providerTemplates]);
  const sourceProviders = useMemo(
    () => providers.filter((provider) => String(provider.provider_source_id || '') === selectedSourceId),
    [providers, selectedSourceId],
  );
  const sourceIsDirty = Boolean(
    selectedSource && editableSource && prettyJson(selectedSource) !== prettyJson(editableSource),
  );

  const mergedModels = useMemo(() => {
    const configured = new Set(sourceProviders.map((provider) => String(provider.model || '')));
    const query = modelSearch.trim().toLowerCase();
    const entries: Array<{ configured: boolean; metadata?: JsonObject; model: string; provider?: JsonObject }> = [
      ...sourceProviders.map((provider) => {
        const model = String(provider.model || recordId(provider, 'id'));
        const metadata = isObject(modelMetadata[model]) ? modelMetadata[model] as JsonObject : undefined;
        return { configured: true, metadata, model, provider };
      }),
      ...availableModels
        .filter((item) => !configured.has(item.name))
        .map((item) => ({ configured: false, metadata: item.metadata, model: item.name })),
    ];
    if (!query) return entries;
    return entries.filter((entry) => entry.model.toLowerCase().includes(query)
      || String(entry.provider?.id || '').toLowerCase().includes(query));
  }, [availableModels, modelMetadata, modelSearch, sourceProviders]);

  const selectSource = (source: JsonObject) => setSelectedSourceId(recordId(source, 'id'));

  const startSource = (template?: JsonObject) => {
    const next = template
      ? sourceFromTemplate(template, providerSources)
      : sourceFromTemplate({ id: 'provider', provider: 'openai', provider_type: activeType, type: activeType }, providerSources);
    setSourceDialogOriginalId('');
    setEditingSourceDialog(next);
    setSourceJson(prettyJson(next));
  };

  const openSourceAdvanced = () => {
    if (!editableSource) return;
    setSourceDialogOriginalId(sourceOriginalId);
    setEditingSourceDialog(editableSource);
    setSourceJson(prettyJson(editableSource));
  };

  const saveSourceDialog = async () => {
    let config: JsonObject;
    try {
      config = parseJsonObject(sourceJson);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Invalid JSON.'));
      return;
    }
    const id = recordId(config, 'id');
    if (!id) {
      toast.error(t('features.provider.providerSources.hints.id'));
      return;
    }
    setSavingSource(true);
    try {
      if (sourceDialogOriginalId) {
        await upsertProviderSourceById({ body: { source_id: sourceDialogOriginalId, config } });
      } else {
        await createProviderSource({ body: { id, config } });
      }
      toast.success(t('features.provider.providerSources.saveSuccess'));
      setEditingSourceDialog(null);
      await load(id);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
    } finally {
      setSavingSource(false);
    }
  };

  const saveEditableSource = async () => {
    if (!editableSource || !sourceOriginalId) return false;
    const id = recordId(editableSource, 'id');
    if (!id) {
      toast.error(t('features.provider.providerSources.hints.id'));
      return false;
    }
    setSavingSource(true);
    try {
      await upsertProviderSourceById({ body: { source_id: sourceOriginalId, config: editableSource } });
      toast.success(t('features.provider.providerSources.saveSuccess'));
      await load(id);
      return true;
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
      return false;
    } finally {
      setSavingSource(false);
    }
  };

  const removeSource = async (source: JsonObject) => {
    const id = recordId(source, 'id');
    if (!id || !await confirmAction({
      danger: true,
      title: t('features.provider.providerSources.delete'),
      message: t('features.provider.providerSources.deleteConfirm', { id }),
    })) return;
    try {
      await deleteProviderSourceById({ query: { source_id: id } });
      toast.success(t('features.provider.providerSources.deleteSuccess'));
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.deleteError')));
    }
  };

  const fetchModels = async () => {
    if (!selectedSourceId) return;
    const sourceId = recordId(editableSource ?? {}, 'id') || selectedSourceId;
    if (sourceIsDirty && !await saveEditableSource()) return;
    setLoadingModels(true);
    try {
      const payload = responseData<JsonObject>(await listProviderSourceModelsById({
        query: { source_id: sourceId, capability: activeTab.capability },
      }));
      const metadata = isObject(payload?.model_metadata) ? payload.model_metadata as JsonObject : {};
      const models = Array.isArray(payload?.models) ? payload.models : [];
      setAvailableMetadata(metadata);
      setAvailableModels(models.map((item) => {
        if (isObject(item)) {
          const name = String(item.name || item.model || '');
          const inlineMetadata = isObject(item.metadata) ? item.metadata : undefined;
          return { name, metadata: inlineMetadata ?? (isObject(metadata[name]) ? metadata[name] as JsonObject : undefined) };
        }
        const name = String(item);
        return { name, metadata: isObject(metadata[name]) ? metadata[name] as JsonObject : undefined };
      }).filter((item) => item.name));
      if (!models.length) toast.info(t('features.provider.models.noModelsFound'));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.models.fetchError')));
    } finally {
      setLoadingModels(false);
    }
  };

  const addAvailableModel = async (model: string, metadata?: JsonObject) => {
    if (!selectedSourceId) return;
    const config = buildModelProvider(selectedSourceId, model, metadata);
    try {
      await createProviderInSourceById({ body: { source_id: selectedSourceId, config } });
      toast.success(t('features.provider.models.addSuccess', { model }));
      await load(selectedSourceId);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
    }
  };

  const openProvider = (provider: JsonObject | null, sourceId = '') => {
    const next = provider ?? {
      id: '',
      provider_source_id: sourceId,
      provider_type: activeType,
      capability: activeTab.capability,
      enable: true,
    };
    setEditingProvider(provider ?? {});
    setProviderJson(prettyJson(next));
  };

  const saveProvider = async () => {
    let config: JsonObject;
    try {
      config = parseJsonObject(providerJson);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Invalid JSON.'));
      return;
    }
    const originalId = recordId(editingProvider ?? {}, 'id', 'provider_id');
    setSavingProvider(true);
    try {
      if (originalId) {
        await updateProviderById({ body: { provider_id: originalId, config } });
      } else if (recordId(config, 'provider_source_id')) {
        await createProviderInSourceById({ body: { source_id: recordId(config, 'provider_source_id'), config } });
      } else {
        await createProvider({ body: { config } });
      }
      toast.success(t('features.provider.messages.success.add'));
      setEditingProvider(null);
      await load(selectedSourceId);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
    } finally {
      setSavingProvider(false);
    }
  };

  const toggleProvider = async (provider: JsonObject) => {
    const id = recordId(provider, 'id', 'provider_id');
    if (!id) return;
    try {
      await setProviderEnabledById({ body: { provider_id: id, enabled: !providerEnabled(provider) } });
      await load(selectedSourceId);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
    }
  };

  const removeProvider = async (provider: JsonObject) => {
    const id = recordId(provider, 'id', 'provider_id');
    if (!id || !await confirmAction({
      danger: true,
      title: t('features.provider.models.title'),
      message: t('features.provider.models.deleteConfirm', { id }),
    })) return;
    try {
      await deleteProviderById({ query: { provider_id: id } });
      toast.success(t('features.provider.models.deleteSuccess'));
      await load(selectedSourceId);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.models.deleteError')));
    }
  };

  const testProvider = async (provider: JsonObject) => {
    const id = recordId(provider, 'id', 'provider_id');
    if (!id) return;
    const startedAt = performance.now();
    setTesting(id);
    try {
      await testProviderById({ body: { provider_id: id } });
      toast.success(t('features.provider.models.testSuccessWithLatency', {
        id,
        latency: Math.max(0, Math.round(performance.now() - startedAt)),
      }));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.models.testError')));
    } finally {
      setTesting('');
    }
  };

  return (
    <div className="provider-page">
      <header className="provider-page__header">
        <div className="provider-page__heading">
          <MdiIcon name="mdi-creation" />
          <div>
            <h1>{t('features.provider.title')}</h1>
            <p>{t('features.provider.subtitle')}</p>
          </div>
        </div>
      </header>

      <nav aria-label={t('features.provider.providerTypes.title')} className="provider-capability-tabs">
        {PROVIDER_TABS.map((tab) => (
          <button
            aria-pressed={activeType === tab.type}
            key={tab.type}
            onClick={() => {
              setActiveType(tab.type);
              setSelectedSourceId('');
            }}
            type="button"
          >
            <MdiIcon name={tab.icon} />
            <span>{t(`features.provider.providers.tabs.${tab.translation}`)}</span>
          </button>
        ))}
      </nav>

      <LoadingState error={error} loading={loading} />

      {!loading && activeType === 'chat_completion' && (
        <section className="provider-workbench">
          <aside className="provider-source-panel">
            <div className="provider-source-panel__header">
              <h2>{t('features.provider.providerSources.title')}</h2>
              <details className="provider-source-add">
                <summary><MdiIcon name="mdi-plus" />{t('features.provider.providerSources.add')}</summary>
                <div className="provider-source-add__menu">
                  {templateOptions.map(({ key, template }) => (
                    <button key={key} onClick={(event) => {
                      (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                      startSource(template);
                    }} type="button"><ProviderMark provider={String(template.provider || '')} /><span>{key}</span></button>
                  ))}
                  <button onClick={(event) => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    startSource();
                  }} type="button"><MdiIcon name="mdi-tune-variant" /><span>{t('features.provider.models.manualAddButton')}</span></button>
                </div>
              </details>
            </div>

            <div className="provider-source-list">
              {visibleSources.map((source) => {
                const id = recordId(source, 'id');
                const active = id === selectedSourceId;
                return (
                  <article className={active ? 'is-active' : ''} key={id}>
                    <button className="provider-source-list__select" onClick={() => selectSource(source)} type="button">
                      <ProviderMark provider={String(source.provider || '')} />
                      <span><strong>{id}</strong><small>{String(source.api_base || source.provider || source.type || '')}</small></span>
                    </button>
                    <button className="provider-source-list__delete" onClick={() => void removeSource(source)} title={t('features.provider.providerSources.delete')} type="button"><MdiIcon name="mdi-delete-outline" /></button>
                  </article>
                );
              })}
              {!visibleSources.length && (
                <div className="provider-source-list__empty"><MdiIcon name="mdi-database-off" /><span>{t('features.provider.providerSources.empty')}</span></div>
              )}
            </div>
          </aside>

          <main className="provider-workbench__main">
            {!selectedSource || !editableSource ? (
              <div className="provider-workbench__empty"><MdiIcon name="mdi-cursor-default-click" /><span>{t('features.provider.providerSources.selectHint')}</span></div>
            ) : (
              <div className="provider-source-config">
                <header className="provider-source-config__header">
                  <div><h2>{recordId(editableSource, 'id')}</h2><p>{String(editableSource.api_base || editableSource.provider || '')}</p></div>
                  <div className="provider-source-config__actions">
                    <button onClick={openSourceAdvanced} type="button"><MdiIcon name="mdi-tune-variant" />{t('features.provider.providerSources.advancedConfig')}</button>
                    <button className="button--primary" disabled={!sourceIsDirty || savingSource} onClick={() => void saveEditableSource()} type="button"><MdiIcon name="mdi-content-save-outline" />{savingSource ? '…' : t('features.provider.providerSources.save')}</button>
                  </div>
                </header>

                <section className="provider-source-fields">
                  <label><span>{t('features.provider.providerSources.fields.name')}</span><input onChange={(event) => setEditableSource({ ...editableSource, id: event.target.value })} value={String(editableSource.id || '')} /></label>
                  <label><span>{t('features.provider.providerSources.fields.apiKey')}</span><input autoComplete="off" onChange={(event) => setEditableSource({ ...editableSource, key: event.target.value })} type="password" value={String(editableSource.key || '')} /></label>
                  <label className="provider-source-fields__wide"><span>{t('features.provider.providerSources.fields.baseUrl')}</span><input onChange={(event) => setEditableSource({ ...editableSource, api_base: event.target.value })} placeholder="https://api.openai.com/v1" value={String(editableSource.api_base || '')} /></label>
                </section>

                <section className="provider-models">
                  <header className="provider-models__header">
                    <div><h3>{t('features.provider.models.title')}</h3><p>{t('features.provider.models.configured')} · {sourceProviders.length}</p></div>
                    <div className="provider-models__actions">
                      <button disabled={loadingModels} onClick={() => void fetchModels()} type="button"><MdiIcon className={loadingModels ? 'is-spinning' : ''} name="mdi-download-outline" />{t('features.provider.providerSources.fetchModels')}</button>
                      <button onClick={() => openProvider(null, selectedSourceId)} type="button"><MdiIcon name="mdi-plus" />{t('features.provider.models.manualAddButton')}</button>
                    </div>
                  </header>
                  <label className="provider-model-search"><MdiIcon name="mdi-magnify" /><input onChange={(event) => setModelSearch(event.target.value)} placeholder={t('features.provider.models.searchPlaceholder')} value={modelSearch} /></label>
                  <div className="provider-model-list">
                    {mergedModels.map((entry) => entry.configured && entry.provider ? (
                      <ProviderRow
                        key={recordId(entry.provider, 'id') || entry.model}
                        metadata={entry.metadata}
                        onDelete={() => void removeProvider(entry.provider!)}
                        onEdit={() => openProvider(entry.provider!)}
                        onTest={() => void testProvider(entry.provider!)}
                        onToggle={() => void toggleProvider(entry.provider!)}
                        provider={entry.provider}
                        testing={testing === recordId(entry.provider, 'id')}
                        t={t}
                      />
                    ) : (
                      <article className="provider-model-row provider-model-row--available" key={`available-${entry.model}`}>
                        <ProviderModelCopy metadata={entry.metadata} model={entry.model} provider={{ model: entry.model }} t={t} />
                        <button onClick={() => void addAvailableModel(entry.model, entry.metadata ?? (isObject(availableMetadata[entry.model]) ? availableMetadata[entry.model] as JsonObject : undefined))} type="button"><MdiIcon name="mdi-plus" />{t('features.provider.models.configure')}</button>
                      </article>
                    ))}
                    {!mergedModels.length && <div className="provider-model-list__empty"><MdiIcon name="mdi-package-variant-closed" /><span>{t('features.provider.models.empty')}</span></div>}
                  </div>
                </section>
              </div>
            )}
          </main>
        </section>
      )}

      {!loading && activeType !== 'chat_completion' && (
        <section className="provider-type-panel">
          <header><div><h2>{t(`features.provider.providers.tabs.${activeTab.translation}`)}</h2><p>{visibleProviders.length} {t('features.provider.providers.title')}</p></div><button className="button--primary" onClick={() => openProvider(null)} type="button"><MdiIcon name="mdi-plus" />{t('features.provider.providers.addProvider')}</button></header>
          <div className="provider-card-grid">
            {visibleProviders.map((provider) => (
              <ProviderCard key={recordId(provider, 'id')} onDelete={() => void removeProvider(provider)} onEdit={() => openProvider(provider)} onTest={() => void testProvider(provider)} onToggle={() => void toggleProvider(provider)} provider={provider} testing={testing === recordId(provider, 'id')} t={t} />
            ))}
          </div>
          {!visibleProviders.length && <div className="provider-type-panel__empty"><MdiIcon name={activeTab.icon} /><p>{t('features.provider.providers.empty.typed', { type: t(`features.provider.providers.tabs.${activeTab.translation}`) })}</p><button onClick={() => openProvider(null)} type="button"><MdiIcon name="mdi-plus" />{t('features.provider.providers.addProvider')}</button></div>}
        </section>
      )}

      <JsonConfigDialog busy={savingSource} onChange={setSourceJson} onOpenChange={(open) => !open && setEditingSourceDialog(null)} onSave={() => void saveSourceDialog()} open={editingSourceDialog !== null} title={sourceDialogOriginalId ? t('features.provider.dialogs.config.editTitle') : t('features.provider.providerSources.add')} value={sourceJson} />
      <JsonConfigDialog busy={savingProvider} onChange={setProviderJson} onOpenChange={(open) => !open && setEditingProvider(null)} onSave={() => void saveProvider()} open={editingProvider !== null} title={recordId(editingProvider ?? {}, 'id') ? t('features.provider.dialogs.config.editTitle') : t('features.provider.dialogs.config.addTitle')} value={providerJson} />
    </div>
  );
}

function ProviderRow({ metadata, onDelete, onEdit, onTest, onToggle, provider, t, testing }: {
  metadata?: JsonObject;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  provider: JsonObject;
  t: ReturnType<typeof useTranslation>['t'];
  testing: boolean;
}) {
  const enabled = providerEnabled(provider);
  return (
    <article className="provider-model-row">
      <ProviderModelCopy metadata={metadata} model={String(provider.model || recordId(provider, 'id'))} provider={provider} t={t} />
      <div className="provider-model-row__actions">
        <label className="provider-switch" title={enabled ? t('features.provider.providerSources.enabled') : t('features.provider.providerSources.disabled')}><input checked={enabled} onChange={onToggle} type="checkbox" /><span /></label>
        <button className={testing ? 'is-loading' : ''} disabled={testing} onClick={onTest} title={t('features.provider.models.testButton')} type="button"><MdiIcon name="mdi-connection" /></button>
        <button onClick={onEdit} title={t('features.provider.dialogs.config.editTitle')} type="button"><MdiIcon name="mdi-pencil-outline" /></button>
        <button className="button--danger" onClick={onDelete} title={t('features.provider.providerSources.delete')} type="button"><MdiIcon name="mdi-delete-outline" /></button>
      </div>
    </article>
  );
}

function ProviderModelCopy({ metadata, model, provider, t }: { metadata?: JsonObject; model: string; provider: JsonObject; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="provider-model-row__copy">
      <ProviderMark provider={String(provider.provider || '')} />
      <span><strong>{recordId(provider, 'id') || model}</strong><small><span>{model}</span><span className="provider-model-badges">{capabilityBadges(provider, metadata).map((badge) => <MdiIcon className={badge.enabled ? '' : 'is-disabled'} key={badge.key} name={badge.icon} />)}{formatContextLimit(provider, metadata) && <b title={t('features.provider.models.metadata.context', { tokens: formatContextLimit(provider, metadata) })}>{formatContextLimit(provider, metadata)}</b>}</span></small></span>
    </div>
  );
}

function ProviderCard({ onDelete, onEdit, onTest, onToggle, provider, t, testing }: {
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  provider: JsonObject;
  t: ReturnType<typeof useTranslation>['t'];
  testing: boolean;
}) {
  const enabled = providerEnabled(provider);
  return (
    <article className="provider-card">
      <header><ProviderMark provider={String(provider.provider || provider.type || '')} /><div><h3>{recordId(provider, 'id')}</h3><p>{String(provider.model || provider.provider || provider.type || '')}</p></div><span className={enabled ? 'is-enabled' : ''}>{enabled ? t('features.provider.providerSources.enabled') : t('features.provider.providerSources.disabled')}</span></header>
      <div className="provider-card__meta"><span><MdiIcon name="mdi-shape-outline" />{String(provider.provider_type || provider.capability || provider.type || 'provider')}</span></div>
      <footer><label className="provider-switch"><input checked={enabled} onChange={onToggle} type="checkbox" /><span /></label><button disabled={testing} onClick={onTest} type="button"><MdiIcon name="mdi-connection" />{t('features.provider.models.testButton')}</button><button onClick={onEdit} type="button"><MdiIcon name="mdi-pencil-outline" />{t('features.provider.dialogs.config.editTitle')}</button><button className="button--danger" onClick={onDelete} type="button"><MdiIcon name="mdi-delete-outline" /></button></footer>
    </article>
  );
}

function ProviderMark({ provider }: { provider: string }) {
  const normalized = provider.toLowerCase();
  const icon: `mdi-${string}` = normalized.includes('ollama') || normalized.includes('lm_studio')
    ? 'mdi-server'
    : normalized.includes('azure') || normalized.includes('microsoft')
      ? 'mdi-web'
      : normalized.includes('google') || normalized.includes('gemini')
        ? 'mdi-creation'
        : 'mdi-creation-outline';
  return <span className="provider-mark"><MdiIcon name={icon} /></span>;
}

function providerEnabled(provider: JsonObject) {
  return (provider.enable ?? provider.enabled) !== false;
}

function cloneObject(value: JsonObject) {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
