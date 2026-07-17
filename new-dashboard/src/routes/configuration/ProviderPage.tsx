import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  createProvider,
  createProviderInSourceById,
  createProviderSource,
  deleteProviderById,
  deleteProviderSourceById,
  getProviderEmbeddingDimensionById,
  getProviderSchema,
  listProviderSourceModelsById,
  listProviders,
  setProviderEnabledById,
  testProviderById,
  updateProviderById,
  upsertProviderSourceById,
} from '@/api/openapi';
import { ConfigGroup } from '@/components/config/DynamicConfigForm';
import type { ConfigGroupMetadata } from '@/components/config/configFormModel';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { confirmAction, toast } from '@/stores/feedback';
import { LoadingState } from './ConfigurationUi';
import { errorMessage, isObject, JsonObject, objectList, prettyJson, recordId, responseData } from './model';
import { getProviderIcon } from './providerIcons';
import {
  buildModelProvider,
  capabilityBadges,
  formatContextLimit,
  mergeProviderSourceSection,
  mergeProviderWithTemplate,
  PROVIDER_TABS,
  providerFromTemplate,
  providerSchemaData,
  providerSourceSections,
  providerTestAction,
  providerTestResult,
  recordsForType,
  sourceFromTemplate,
  sourceTemplatesForType,
  type ProviderType,
  type ProviderTestStatus,
} from './providerPageModel';

type AvailableModel = { metadata?: JsonObject; name: string };

export default function ProviderPage() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<JsonObject[]>([]);
  const [providerSources, setProviderSources] = useState<JsonObject[]>([]);
  const [providerTemplates, setProviderTemplates] = useState<JsonObject>({});
  const [providerSourceSchema, setProviderSourceSchema] = useState<JsonObject>({});
  const [modelMetadata, setModelMetadata] = useState<JsonObject>({});
  const [activeType, setActiveType] = useState<ProviderType>('chat_completion');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [editableSource, setEditableSource] = useState<JsonObject | null>(null);
  const [sourceOriginalId, setSourceOriginalId] = useState('');
  const [newSourceId, setNewSourceId] = useState('');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableMetadata, setAvailableMetadata] = useState<JsonObject>({});
  const [modelSearch, setModelSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState('');
  const [providerStatuses, setProviderStatuses] = useState<Record<string, ProviderTestStatus>>({});
  const [savingProvider, setSavingProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<JsonObject | null>(null);
  const [editingProviderOriginalId, setEditingProviderOriginalId] = useState('');
  const [editingProviderName, setEditingProviderName] = useState('');
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [providerPickerType, setProviderPickerType] = useState<ProviderType>('agent_runner');
  const [agentRunnerHelpOpen, setAgentRunnerHelpOpen] = useState(false);
  const [detectingEmbeddingDimension, setDetectingEmbeddingDimension] = useState(false);
  const [manualModelOpen, setManualModelOpen] = useState(false);
  const [manualModelId, setManualModelId] = useState('');
  const [modelEditor, setModelEditor] = useState<JsonObject | null>(null);
  const [modelEditorOriginalId, setModelEditorOriginalId] = useState('');

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
      setProviderSourceSchema(data.sourceSchema);
      setModelMetadata(data.modelMetadata);
      setNewSourceId('');
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
        setProviderSourceSchema({});
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
  const pickerTemplateOptions = useMemo(() => sourceTemplatesForType(providerTemplates, providerPickerType), [providerPickerType, providerTemplates]);
  const sourceProviders = useMemo(
    () => providers.filter((provider) => String(provider.provider_source_id || '') === selectedSourceId),
    [providers, selectedSourceId],
  );
  const sourceIsDirty = Boolean(
    selectedSource && editableSource
      && (selectedSourceId === newSourceId || prettyJson(selectedSource) !== prettyJson(editableSource)),
  );
  const sourceSections = useMemo(
    () => editableSource ? providerSourceSections(editableSource) : null,
    [editableSource],
  );
  const sourceFieldMetadata = useMemo(() => {
    const items = isObject(providerSourceSchema.items) ? providerSourceSchema.items : {};
    const item = (key: string) => isObject(items[key]) ? items[key] as JsonObject : {};
    return {
      ...providerSourceSchema,
      items: {
        ...items,
        id: { ...item('id'), hint: t('features.provider.providerSources.hints.id') },
        key: { ...item('key'), hint: t('features.provider.providerSources.hints.key') },
        api_base: { ...item('api_base'), hint: t('features.provider.providerSources.hints.apiBase') },
        proxy: {
          ...item('proxy'),
          description: t('features.provider.providerSources.labels.proxy'),
          hint: t('features.provider.providerSources.hints.proxy'),
        },
      },
    } as ConfigGroupMetadata;
  }, [providerSourceSchema, t]);
  const modelFieldMetadata = useMemo(() => {
    const metadata = cloneObject(providerSourceSchema);
    const items = isObject(metadata.items) ? metadata.items : {};
    const hiddenKeys = ['id', 'model'];
    if (String(selectedSource?.type || '') === 'googlegenai_chat_completion') hiddenKeys.push('custom_extra_body');
    const nextItems = Object.fromEntries(Object.entries(items).map(([key, value]) => [
      key,
      hiddenKeys.includes(key) && isObject(value) ? { ...value, invisible: true } : value,
    ]));
    for (const key of hiddenKeys) {
      const item = isObject(nextItems[key]) ? nextItems[key] as JsonObject : {};
      nextItems[key] = { ...item, invisible: true };
    }
    metadata.items = nextItems;
    return metadata as ConfigGroupMetadata;
  }, [providerSourceSchema, selectedSource]);

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
  const configuredModels = useMemo(() => mergedModels.filter((entry) => entry.configured), [mergedModels]);
  const unconfiguredModels = useMemo(() => mergedModels.filter((entry) => !entry.configured), [mergedModels]);

  const selectSource = (source: JsonObject) => setSelectedSourceId(recordId(source, 'id'));

  const startSource = (template: JsonObject) => {
    const next = sourceFromTemplate(template, providerSources);
    const id = recordId(next, 'id');
    setProviderSources((current) => [...current, next]);
    setNewSourceId(id);
    setSelectedSourceId(id);
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
      if (selectedSourceId === newSourceId) {
        await createProviderSource({ body: { id, config: editableSource } });
      } else {
        await upsertProviderSourceById({ body: { source_id: sourceOriginalId, config: editableSource } });
      }
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
    if (id === newSourceId) {
      setProviderSources((current) => current.filter((item) => recordId(item, 'id') !== id));
      setSelectedSourceId('');
      setNewSourceId('');
      return;
    }
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

  const openModelEditor = (config: JsonObject, originalId = '') => {
    setModelEditor(cloneObject(config));
    setModelEditorOriginalId(originalId);
  };

  const openManualModel = () => {
    if (!selectedSourceId) return;
    setManualModelId('');
    setManualModelOpen(true);
  };

  const confirmManualModel = () => {
    const model = manualModelId.trim();
    if (!model) {
      toast.warning(t('features.provider.models.manualModelRequired'));
      return;
    }
    if (sourceProviders.some((provider) => String(provider.model || '') === model)) {
      toast.warning(t('features.provider.models.manualModelExists'));
      return;
    }
    setManualModelOpen(false);
    openModelEditor(buildModelProvider(selectedSourceId, model));
  };

  const openAvailableModel = (model: string, metadata?: JsonObject) => {
    if (!selectedSourceId) return;
    openModelEditor(buildModelProvider(selectedSourceId, model, metadata));
  };

  const saveModelEditor = async () => {
    if (!modelEditor) return;
    const sourceId = String(modelEditor.provider_source_id || selectedSourceId);
    setSavingProvider(true);
    try {
      if (modelEditorOriginalId) {
        await updateProviderById({ body: { provider_id: modelEditorOriginalId, config: modelEditor } });
      } else {
        await createProviderInSourceById({ body: { source_id: sourceId, config: modelEditor } });
      }
      toast.success(t('features.provider.messages.success.add'));
      setModelEditor(null);
      setModelEditorOriginalId('');
      await load(sourceId);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
    } finally {
      setSavingProvider(false);
    }
  };

  const openProviderPicker = () => {
    setProviderPickerType(activeType === 'chat_completion' ? 'agent_runner' : activeType);
    setProviderPickerOpen(true);
  };

  const selectProviderTemplate = (name: string, template: JsonObject) => {
    setEditingProvider(providerFromTemplate(template));
    setEditingProviderOriginalId('');
    setEditingProviderName(name);
    setProviderPickerOpen(false);
  };

  const openProvider = (provider: JsonObject) => {
    const templateEntry = Object.entries(providerTemplates).find(([, template]) => (
      isObject(template) && String(template.type || '') === String(provider.type || '')
    ));
    const template = templateEntry && isObject(templateEntry[1]) ? templateEntry[1] as JsonObject : {};
    setEditingProvider(mergeProviderWithTemplate(provider, template));
    setEditingProviderOriginalId(recordId(provider, 'id', 'provider_id'));
    setEditingProviderName(templateEntry?.[0] || recordId(provider, 'id', 'provider_id'));
  };

  const saveProvider = async () => {
    if (!editingProvider) return;
    const id = recordId(editingProvider, 'id', 'provider_id');
    if (!id) {
      toast.warning(t('features.provider.providerSources.hints.id'));
      return;
    }
    setSavingProvider(true);
    try {
      if (editingProviderOriginalId) {
        await updateProviderById({ body: { provider_id: editingProviderOriginalId, config: editingProvider } });
      } else {
        await createProvider({ body: { config: editingProvider } });
      }
      toast.success(t(editingProviderOriginalId ? 'features.provider.messages.success.update' : 'features.provider.messages.success.add'));
      setEditingProvider(null);
      setEditingProviderOriginalId('');
      await load();
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

  const copyProvider = async (provider: JsonObject) => {
    const sourceId = recordId(provider, 'id', 'provider_id');
    if (!sourceId) return;
    const existingIds = new Set(providers.map((item) => recordId(item, 'id', 'provider_id')));
    let copyId = `${sourceId}_copy`;
    let suffix = 1;
    while (existingIds.has(copyId)) copyId = `${sourceId}_copy_${suffix++}`;
    const copy = cloneObject(provider);
    copy.id = copyId;
    copy.enable = false;
    try {
      await createProvider({ body: { config: copy } });
      toast.success(t('features.provider.messages.success.add'));
      await load(selectedSourceId);
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.providerSources.saveError')));
    }
  };

  const testProvider = async (provider: JsonObject) => {
    const id = recordId(provider, 'id', 'provider_id');
    if (!id) return;
    const action = providerTestAction(provider);
    if (action === 'disabled') {
      const message = t('features.provider.providerSources.disabled');
      setProviderStatuses((current) => ({ ...current, [id]: { status: 'unavailable', error: message } }));
      toast.error(message);
      return;
    }
    if (action === 'agent_runner') {
      setAgentRunnerHelpOpen(true);
      return;
    }
    const startedAt = performance.now();
    setTesting(id);
    setProviderStatuses((current) => ({ ...current, [id]: { status: 'pending', error: null } }));
    try {
      const result = providerTestResult(responseData(await testProviderById({ body: { provider_id: id } })));
      if (result.status !== 'available' || result.error) {
        throw new Error(result.error || t('features.provider.models.testError'));
      }
      setProviderStatuses((current) => ({ ...current, [id]: result }));
      toast.success(t('features.provider.models.testSuccessWithLatency', {
        id,
        latency: Math.max(0, Math.round(performance.now() - startedAt)),
      }));
    } catch (cause) {
      const message = errorMessage(cause, t('features.provider.models.testError'));
      setProviderStatuses((current) => ({ ...current, [id]: { status: 'unavailable', error: message } }));
      toast.error(message);
    } finally {
      setTesting('');
    }
  };

  const detectEmbeddingDimension = async () => {
    if (!editingProvider || detectingEmbeddingDimension) return;
    const id = recordId(editingProvider, 'id', 'provider_id');
    if (!id) {
      toast.error(t('features.provider.embeddingDimension.missingId'));
      return;
    }
    setDetectingEmbeddingDimension(true);
    try {
      const data = responseData<JsonObject>(await getProviderEmbeddingDimensionById({
        body: { provider_id: id, provider_config: editingProvider },
      }));
      const dimension = Number(data?.embedding_dimensions);
      if (!Number.isFinite(dimension) || dimension <= 0) throw new Error(t('features.provider.embeddingDimension.invalidResponse'));
      setEditingProvider((current) => current ? { ...current, embedding_dimensions: dimension } : current);
      toast.success(t('features.provider.embeddingDimension.success', { dimension }));
    } catch (cause) {
      toast.error(errorMessage(cause, t('features.provider.embeddingDimension.error')));
    } finally {
      setDetectingEmbeddingDimension(false);
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
                    }} type="button"><ProviderMark provider={String(template.provider || '')} variant="menu" /><span>{key}</span></button>
                  ))}
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
                    <button className="provider-button provider-button--pill provider-button--tonal" disabled={!sourceIsDirty || savingSource} onClick={() => void saveEditableSource()} type="button"><MdiIcon name="mdi-content-save-outline" />{savingSource ? '…' : t('features.provider.providerSources.save')}</button>
                  </div>
                </header>

                {sourceSections && (
                  <div className="provider-source-config__settings">
                    <section className="provider-source-config__section">
                      <h3>{t('features.provider.providers.settings')}</h3>
                      <ConfigGroup
                        conditionValue={editableSource}
                        fieldsFromValue
                        metadata={sourceFieldMetadata}
                        onChange={(next) => setEditableSource(mergeProviderSourceSection(editableSource, next))}
                        translationPath="provider"
                        value={sourceSections.basic}
                        variant="inline"
                      />
                    </section>
                    {Object.keys(sourceSections.advanced).length > 0 && (
                      <section className="provider-source-config__section">
                        <h3>{t('features.provider.providerSources.advancedConfig')}</h3>
                        <ConfigGroup
                          conditionValue={editableSource}
                          fieldsFromValue
                          metadata={sourceFieldMetadata}
                          onChange={(next) => setEditableSource(mergeProviderSourceSection(editableSource, next))}
                          translationPath="provider"
                          value={sourceSections.advanced}
                          variant="inline"
                        />
                      </section>
                    )}
                  </div>
                )}

                <section className="provider-models">
                  <header className="provider-models__header">
                    <div><h3>{t('features.provider.models.title')}</h3><p>{t('features.provider.models.available')} {availableModels.length}</p></div>
                    <div className="provider-models__actions">
                      <label className="provider-model-search"><MdiIcon name="mdi-magnify" /><input onChange={(event) => setModelSearch(event.target.value)} placeholder={t('features.provider.models.searchPlaceholder')} value={modelSearch} /></label>
                      <button className="provider-button provider-button--pill provider-button--tonal" disabled={loadingModels} onClick={() => void fetchModels()} type="button"><MdiIcon className={loadingModels ? 'is-spinning' : ''} name="mdi-download" />{t(sourceIsDirty ? 'features.provider.providerSources.saveAndFetchModels' : 'features.provider.providerSources.fetchModels')}</button>
                      <button className="provider-button provider-button--pill provider-button--text" onClick={openManualModel} type="button"><MdiIcon name="mdi-pencil-plus" />{t('features.provider.models.manualAddButton')}</button>
                    </div>
                  </header>
                  <div className="provider-models__sections">
                    <section className="provider-model-section">
                      <div className="provider-model-section__heading"><h4>{t('features.provider.models.configured')}</h4><span>{configuredModels.length}</span></div>
                      <div className="provider-model-list">
                        {configuredModels.map((entry) => entry.provider && <ProviderRow
                          key={recordId(entry.provider, 'id') || entry.model}
                          metadata={entry.metadata}
                          onDelete={() => void removeProvider(entry.provider!)}
                          onEdit={() => openModelEditor(entry.provider!, recordId(entry.provider!, 'id', 'provider_id'))}
                          onTest={() => void testProvider(entry.provider!)}
                          onToggle={() => void toggleProvider(entry.provider!)}
                          provider={entry.provider}
                          status={providerStatuses[recordId(entry.provider, 'id')]}
                          testing={testing === recordId(entry.provider, 'id')}
                          t={t}
                        />)}
                        {!configuredModels.length && <div className="provider-model-list__empty"><MdiIcon name="mdi-package-variant-closed" /><span>{t('features.provider.models.empty')}</span></div>}
                      </div>
                    </section>
                    <section className="provider-model-section">
                      <div className="provider-model-section__heading"><h4>{t('features.provider.models.available')}</h4><span>{unconfiguredModels.length}</span></div>
                      <div className="provider-model-list">
                        {unconfiguredModels.map((entry) => <article className="provider-model-row provider-model-row--available" key={`available-${entry.model}`}>
                          <ProviderModelCopy metadata={entry.metadata} model={entry.model} provider={{ model: entry.model }} t={t} />
                          <button aria-label={t('features.provider.models.configure')} onClick={() => openAvailableModel(entry.model, entry.metadata ?? (isObject(availableMetadata[entry.model]) ? availableMetadata[entry.model] as JsonObject : undefined))} title={t('features.provider.models.configure')} type="button"><MdiIcon name="mdi-plus" /></button>
                        </article>)}
                        {!unconfiguredModels.length && <div className="provider-model-list__empty provider-model-list__empty--available"><MdiIcon name="mdi-database-search-outline" /><span>{t('features.provider.models.noModelsFound')}</span></div>}
                      </div>
                    </section>
                  </div>
                </section>
              </div>
            )}
          </main>
        </section>
      )}

      {!loading && activeType !== 'chat_completion' && (
        <section className="provider-type-panel">
          <header><div><h2>{t(`features.provider.providers.tabs.${activeTab.translation}`)}</h2></div><button className="button--primary" onClick={openProviderPicker} type="button"><MdiIcon name="mdi-plus" />{t('features.provider.providers.addProvider')}</button></header>
          <div className="provider-card-grid">
            {visibleProviders.map((provider) => (
              <ProviderCard key={recordId(provider, 'id')} onCopy={() => void copyProvider(provider)} onDelete={() => void removeProvider(provider)} onEdit={() => openProvider(provider)} onTest={() => void testProvider(provider)} onToggle={() => void toggleProvider(provider)} provider={provider} status={providerStatuses[recordId(provider, 'id')]} testing={testing === recordId(provider, 'id')} t={t} />
            ))}
          </div>
          {!visibleProviders.length && <div className="provider-type-panel__empty"><MdiIcon name={activeTab.icon} /><p>{t('features.provider.providers.empty.typed', { type: t(`features.provider.providers.tabs.${activeTab.translation}`) })}</p><button onClick={openProviderPicker} type="button"><MdiIcon name="mdi-plus" />{t('features.provider.providers.addProvider')}</button></div>}
        </section>
      )}

      <Dialog onOpenChange={setProviderPickerOpen} open={providerPickerOpen} title={t('features.provider.dialogs.addProvider.title')}>
        <div className="provider-template-picker">
          <nav aria-label={t('features.provider.providerTypes.title')}>
            {PROVIDER_TABS.filter((tab) => tab.type !== 'chat_completion').map((tab) => (
              <button aria-pressed={providerPickerType === tab.type} key={tab.type} onClick={() => setProviderPickerType(tab.type)} type="button">
                <MdiIcon name={tab.icon} />
                <span>{t(`features.provider.dialogs.addProvider.tabs.${tab.translation}`)}</span>
              </button>
            ))}
          </nav>
          <div className="provider-template-picker__grid">
            {pickerTemplateOptions.map(({ key, template }) => (
              <button className="provider-template-card" key={key} onClick={() => selectProviderTemplate(key, template)} type="button">
                <span><strong>{key}</strong><small>{providerTemplateDescription(template, key, t)}</small></span>
                <ProviderMark provider={String(template.provider || '')} variant="menu" />
              </button>
            ))}
            {!pickerTemplateOptions.length && <div className="provider-template-picker__empty"><MdiIcon name="mdi-information-outline" />{t('features.provider.dialogs.addProvider.noTemplates')}</div>}
          </div>
          <footer><button onClick={() => setProviderPickerOpen(false)} type="button">{t('features.provider.dialogs.config.cancel')}</button></footer>
        </div>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null);
            setEditingProviderOriginalId('');
          }
        }}
        open={editingProvider !== null}
        title={editingProviderOriginalId
          ? t('features.provider.dialogs.config.editTitle')
          : `${t('features.provider.dialogs.config.addTitle')} ${editingProviderName} ${t('features.provider.dialogs.config.provider')}`}
      >
        {editingProvider && (
          <div className="provider-template-editor-dialog">
            <div className="provider-template-editor-dialog__body">
              <ConfigGroup
                conditionValue={editingProvider}
                embeddingDimensionLoading={detectingEmbeddingDimension}
                fieldsFromValue
                metadata={providerSourceSchema as ConfigGroupMetadata}
                onChange={setEditingProvider}
                onGetEmbeddingDimension={() => void detectEmbeddingDimension()}
                showValueHint
                translationPath="provider"
                value={editingProvider}
                variant="inline"
              />
            </div>
            <footer>
              <button disabled={savingProvider} onClick={() => setEditingProvider(null)} type="button">{t('features.provider.dialogs.config.cancel')}</button>
              <button className="provider-dialog-button--primary" disabled={savingProvider} onClick={() => void saveProvider()} type="button">{savingProvider ? '…' : t('features.provider.dialogs.config.save')}</button>
            </footer>
          </div>
        )}
      </Dialog>

      <Dialog
        onOpenChange={setManualModelOpen}
        open={manualModelOpen}
        title={t('features.provider.models.manualDialogTitle')}
      >
        <form className="provider-manual-model-dialog" onSubmit={(event) => { event.preventDefault(); confirmManualModel(); }}>
          <label>
            <span>{t('features.provider.models.manualDialogModelLabel')}</span>
            <input autoFocus onChange={(event) => setManualModelId(event.target.value)} value={manualModelId} />
          </label>
          <label>
            <span>{t('features.provider.models.manualDialogPreviewLabel')}</span>
            <input readOnly value={manualModelId.trim() ? `${selectedSourceId}/${manualModelId.trim()}` : ''} />
            <small>{t('features.provider.models.manualDialogPreviewHint')}</small>
          </label>
          <footer>
            <button onClick={() => setManualModelOpen(false)} type="button">{t('core.common.cancel')}</button>
            <button className="provider-dialog-button--primary" disabled={!manualModelId.trim()} type="submit">{t('core.common.add')}</button>
          </footer>
        </form>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setModelEditor(null);
            setModelEditorOriginalId('');
          }
        }}
        open={modelEditor !== null}
        title={`${t(modelEditorOriginalId ? 'features.provider.dialogs.config.editTitle' : 'features.provider.dialogs.config.addTitle')}${modelEditor ? ` · ${recordId(modelEditor, 'id')}` : ''}`}
      >
        {modelEditor && (
          <div className="provider-model-editor-dialog">
            <div className="provider-model-editor-dialog__body">
              <ConfigGroup
                conditionValue={modelEditor}
                fieldsFromValue
                metadata={modelFieldMetadata}
                onChange={(next) => setModelEditor(next)}
                translationPath="provider"
                value={modelEditor}
                variant="inline"
              />
            </div>
            <footer>
              <button onClick={() => setModelEditor(null)} type="button">{t('core.common.cancel')}</button>
              <button className="provider-dialog-button--primary" disabled={savingProvider} onClick={() => void saveModelEditor()} type="button">{savingProvider ? '…' : t('features.provider.dialogs.config.save')}</button>
            </footer>
          </div>
        )}
      </Dialog>

      <Dialog description={t('features.provider.agentRunnerTest.description')} onOpenChange={setAgentRunnerHelpOpen} open={agentRunnerHelpOpen} title={t('features.provider.agentRunnerTest.title')}>
        <div className="provider-agent-runner-help">
          <ol>
            <li>{t('features.provider.agentRunnerTest.steps.openConfig')}</li>
            <li>{t('features.provider.agentRunnerTest.steps.selectRunner')}</li>
            <li>{t('features.provider.agentRunnerTest.steps.openChat')}</li>
          </ol>
          <p>{t('features.provider.agentRunnerTest.hint')}</p>
          <footer><button onClick={() => setAgentRunnerHelpOpen(false)} type="button">{t('core.common.confirm')}</button><Link className="button--primary" to="/config">{t('features.provider.agentRunnerTest.goToConfig')}</Link></footer>
        </div>
      </Dialog>

    </div>
  );
}

function providerTemplateDescription(template: JsonObject, name: string, t: ReturnType<typeof useTranslation>['t']) {
  if (name === 'OpenAI') return t('features.provider.providers.description.openai', { type: String(template.type || '') });
  if (template.provider === 'kimi-code') return t('features.provider.providers.description.kimi_code');
  if (name === 'vLLM Rerank') return t('features.provider.providers.description.vllm_rerank', { type: String(template.type || '') });
  return t('features.provider.providers.description.default', { type: String(template.type || '') });
}

function ProviderRow({ metadata, onDelete, onEdit, onTest, onToggle, provider, status, t, testing }: {
  metadata?: JsonObject;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  provider: JsonObject;
  status?: ProviderTestStatus;
  t: ReturnType<typeof useTranslation>['t'];
  testing: boolean;
}) {
  const enabled = providerEnabled(provider);
  return (
    <article className="provider-model-row">
      <ProviderModelCopy metadata={metadata} model={String(provider.model || recordId(provider, 'id'))} provider={provider} t={t} />
      <div className="provider-model-row__actions">
        {status && <ProviderStatus status={status} t={t} />}
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

function ProviderCard({ onCopy, onDelete, onEdit, onTest, onToggle, provider, status, t, testing }: {
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  provider: JsonObject;
  status?: ProviderTestStatus;
  t: ReturnType<typeof useTranslation>['t'];
  testing: boolean;
}) {
  const enabled = providerEnabled(provider);
  const providerName = String(provider.provider || provider.type || '');
  return (
    <article className="provider-card">
      <header><h3 title={recordId(provider, 'id')}>{recordId(provider, 'id')}</h3><label className="provider-switch" title={enabled ? t('core.common.itemCard.enabled') : t('core.common.itemCard.disabled')}><input checked={enabled} onChange={onToggle} type="checkbox" /><span /></label></header>
      {status && <ProviderStatus status={status} t={t} />}
      <footer><button className="button--danger" onClick={onDelete} type="button">{t('core.common.itemCard.delete')}</button><button className="button--primary-soft" onClick={onEdit} type="button">{t('core.common.itemCard.edit')}</button><button className="button--secondary-soft" onClick={onCopy} type="button">{t('core.common.itemCard.copy')}</button><button className="button--info-soft" disabled={testing} onClick={onTest} type="button">{t('features.provider.availability.test')}</button></footer>
      <div aria-hidden="true" className="provider-card__background"><ProviderMark provider={providerName} /></div>
    </article>
  );
}

function ProviderStatus({ status, t }: { status: ProviderTestStatus; t: ReturnType<typeof useTranslation>['t'] }) {
  return <span className={`provider-test-status provider-test-status--${status.status}`} title={status.error || undefined}>
    <MdiIcon name={status.status === 'available' ? 'mdi-check-circle' : status.status === 'pending' ? 'mdi-loading' : 'mdi-alert-circle'} />
    {t(`features.provider.availability.${status.status}`)}
    {status.error && <small>{status.error}</small>}
  </span>;
}

function ProviderMark({ provider, variant = 'source' }: { provider: string; variant?: 'menu' | 'source' }) {
  const normalized = provider.toLowerCase();
  const image = getProviderIcon(provider);
  const [failedImage, setFailedImage] = useState('');
  const icon: `mdi-${string}` = normalized.includes('ollama') || normalized.includes('lm_studio')
    ? 'mdi-server'
    : normalized.includes('azure') || normalized.includes('microsoft')
      ? 'mdi-web'
      : normalized.includes('google') || normalized.includes('gemini')
        ? 'mdi-creation'
        : 'mdi-creation-outline';
  return (
    <span className={`provider-mark provider-mark--${variant}`}>
      {image && failedImage !== image ? (
        <img
          alt=""
          aria-hidden="true"
          src={image}
          onError={() => setFailedImage(image)}
        />
      ) : (
        <MdiIcon name={icon} />
      )}
    </span>
  );
}

function providerEnabled(provider: JsonObject) {
  return (provider.enable ?? provider.enabled) !== false;
}

function cloneObject(value: JsonObject) {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
