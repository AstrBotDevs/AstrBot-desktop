import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deletePluginConfigFile, listPluginConfigFiles, uploadPluginConfigFiles } from '@/api/openapi';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { ExpandCollapse } from '@/components/motion/ExpandCollapse';
import { toast } from '@/stores/feedback';
import { ConfigSpecialSelector, isConfigSelectorSpecial, PersonaQuickPreview } from './ConfigSpecialControls';
import { DashboardTotpManager, T2ITemplateEditor } from './ConfigSpecialEditors';
import { isSafePluginConfigPath, pluginConfigUploadBody } from './pluginFileModel';
import { ObjectConfigControl as ObjectControl } from './ObjectConfigControl';

import {
  configItemsForValue,
  getConfigValue,
  inferConfigMetadata,
  isConfigRecord,
  matchesConfigCondition,
  setConfigValue,
  type ConfigGroupMetadata,
  type ConfigItemMetadata,
  type ConfigRecord,
} from './configFormModel';

type TextResolver = (path: string, field: 'description' | 'hint', fallback?: string) => string;

function JsonControl({ disabled, onChange, value }: { disabled?: boolean; onChange: (value: unknown) => void; value: unknown }) {
  const serialized = useMemo(() => JSON.stringify(value ?? null, null, 2), [value]);
  const [source, setSource] = useState(serialized);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => { setSource(serialized); setInvalid(false); }, [serialized]);

  const apply = () => {
    try {
      onChange(JSON.parse(source));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };

  return <textarea aria-invalid={invalid} className="dynamic-config__json" disabled={disabled} onBlur={apply} onChange={(event) => setSource(event.target.value)} rows={5} value={source} />;
}

function StringListControl({ disabled, onChange, value }: { disabled?: boolean; onChange: (value: unknown) => void; value: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [newItem, setNewItem] = useState('');
  const [editIndex, setEditIndex] = useState(-1);
  const [editItem, setEditItem] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const batchCount = batchText.split('\n').map((line) => line.trim()).filter(Boolean).length;

  useEffect(() => { if (!open) setDraft(value); }, [open, value]);

  const setSingleValue = (next: string) => onChange(next === '' ? [] : [next]);
  const addItem = () => {
    if (!newItem.trim()) return;
    setDraft((current) => [...current, newItem.trim()]);
    setNewItem('');
  };
  const showDialog = () => {
    setDraft(value);
    setNewItem('');
    setEditIndex(-1);
    setEditItem('');
    setOpen(true);
  };
  const save = () => {
    onChange(draft.filter((item) => item.trim() !== ''));
    setOpen(false);
  };
  const saveEdit = () => {
    if (editIndex < 0 || !editItem.trim()) return;
    setDraft((current) => current.map((item, index) => index === editIndex ? editItem.trim() : item));
    setEditIndex(-1);
    setEditItem('');
  };
  const importBatch = () => {
    const items = batchText.split('\n').map((line) => line.trim()).filter(Boolean);
    setDraft((current) => [...current, ...items]);
    setBatchText('');
    setBatchOpen(false);
  };

  return <div className="dynamic-list">
    {value.length <= 1
      ? <input disabled={disabled} onChange={(event) => setSingleValue(event.target.value)} value={value[0] ?? ''} />
      : <div className="dynamic-list__preview"><span>{value[0]}</span>{value.length > 1 && <span>+{value.length - 1}</span>}</div>}
    {!disabled && <button className="dynamic-list__manage" onClick={showDialog} type="button">{value.length <= 1 ? t('core.common.list.addMore') : t('core.common.list.modifyButton')}</button>}
    <Dialog onOpenChange={setOpen} open={open} title={t('core.common.list.editTitle')}>
      <div className="dynamic-list-dialog">
        <div className="dynamic-list-dialog__add"><input onChange={(event) => setNewItem(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }} placeholder={t('core.common.list.addItemPlaceholder')} value={newItem} /><button className="dynamic-editor-button--tonal" disabled={!newItem.trim()} onClick={addItem} type="button">{t('core.common.list.addButton')}</button><button className="dynamic-editor-button--tonal" onClick={() => setBatchOpen(true)} type="button"><MdiIcon name="mdi-import" />{t('core.common.list.batchImport')}</button></div>
        <div className="dynamic-list-dialog__items">
          {draft.map((item, index) => <div className="dynamic-list-dialog__item" key={index} onClick={() => { if (editIndex !== index) { setEditIndex(index); setEditItem(item); } }}>
            {editIndex === index ? <input autoFocus onChange={(event) => setEditItem(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(); if (event.key === 'Escape') setEditIndex(-1); }} value={editItem} /> : <span>{item}</span>}
            {editIndex === index && <button className="is-success" aria-label={t('core.common.confirm')} onClick={(event) => { event.stopPropagation(); saveEdit(); }} type="button"><MdiIcon name="mdi-check" /></button>}
            <button aria-label={t('features.config.actions.delete')} onClick={(event) => { event.stopPropagation(); if (editIndex === index) { setEditIndex(-1); setEditItem(''); } else setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index)); }} type="button"><MdiIcon name={editIndex === index ? 'mdi-close' : 'mdi-close'} /></button>
          </div>)}
          {!draft.length && <div className="dynamic-editor-empty"><MdiIcon name="mdi-format-list-bulleted" /><p>{t('core.common.list.noItemsHint')}</p></div>}
        </div>
        <div className="dialog-actions"><button onClick={() => setOpen(false)} type="button">{t('core.common.cancel')}</button><button className="button--primary" onClick={save} type="button">{t('core.common.confirm')}</button></div>
      </div>
    </Dialog>
    <Dialog description={t('core.common.list.batchImportHint')} onOpenChange={setBatchOpen} open={batchOpen} title={t('core.common.list.batchImportTitle')}>
      <div className="dynamic-batch-dialog">
        <label><span>{t('core.common.list.batchImportLabel')}</span><textarea onChange={(event) => setBatchText(event.target.value)} placeholder={t('core.common.list.batchImportPlaceholder')} rows={10} value={batchText} /></label>
        <div className="dialog-actions"><button onClick={() => { setBatchText(''); setBatchOpen(false); }} type="button">{t('core.common.cancel')}</button><button className="button--primary" disabled={!batchCount} onClick={importBatch} type="button">{t('core.common.list.batchImportButton', { count: batchCount })}</button></div>
      </div>
    </Dialog>
  </div>;
}

type PluginFileItem = { path: string; status: 'missing' | 'ok' | 'unconfigured' };

function pluginFileResponseData(response: unknown) {
  const outer = (response as { data?: unknown } | null)?.data;
  if (!outer || typeof outer !== 'object') return outer as Record<string, unknown> | undefined;
  return (((outer as { data?: unknown }).data ?? outer) as Record<string, unknown>);
}

function PluginFileConfigControl({ configKey, metadata, onChange, pluginName, value }: {
  configKey: string;
  metadata: ConfigItemMetadata;
  onChange: (value: unknown) => void;
  pluginName: string;
  value: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [directoryFiles, setDirectoryFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileTypes = Array.isArray(metadata.file_types) ? metadata.file_types.map(String) : [];
  const accept = fileTypes.map((extension) => `.${extension.replace(/^\./, '')}`).join(',');
  const items = useMemo<PluginFileItem[]>(() => {
    const configured = new Set(value);
    const existing = new Set(directoryFiles);
    return [
      ...value.map((path): PluginFileItem => ({ path, status: existing.has(path) ? 'ok' : 'missing' })),
      ...directoryFiles.filter((path) => !configured.has(path)).map((path): PluginFileItem => ({ path, status: 'unconfigured' })),
    ];
  }, [directoryFiles, value]);

  const load = async () => {
    if (!pluginName || !configKey) return;
    setBusy(true);
    try {
      const response = await listPluginConfigFiles({ path: { plugin_id: pluginName, config_key: configKey } });
      const files = pluginFileResponseData(response)?.files;
      setDirectoryFiles(Array.isArray(files) ? Array.from(new Set(files.filter(isSafePluginConfigPath))) : []);
    } catch {
      toast.warning(t('features.config.fileUpload.loadFailed'));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: File[]) => {
    if (!files.length || busy) return;
    const valid = files.filter((file) => {
      if (file.size <= 500 * 1024 * 1024) return true;
      toast.warning(t('features.config.fileUpload.fileTooLarge', { max: 500, name: file.name }));
      return false;
    });
    if (!valid.length) return;
    setBusy(true);
    try {
      const response = await uploadPluginConfigFiles({
        path: { plugin_id: pluginName, config_key: configKey },
        body: pluginConfigUploadBody(valid),
      });
      const data = pluginFileResponseData(response);
      const uploadedRaw = data?.uploaded;
      const errorsRaw = data?.errors;
      const uploaded = Array.isArray(uploadedRaw) ? uploadedRaw.filter(isSafePluginConfigPath) : [];
      const errors = Array.isArray(errorsRaw) ? errorsRaw.map(String) : [];
      if (uploaded.length) {
        onChange(Array.from(new Set([...value, ...uploaded])));
        setDirectoryFiles((current) => Array.from(new Set([...current, ...uploaded])));
        toast.success(t('features.config.fileUpload.uploadSuccess', { count: uploaded.length }));
      }
      if (errors.length) toast.warning(errors.join('\n'));
    } catch {
      toast.error(t('features.config.fileUpload.uploadFailed'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (item: PluginFileItem) => {
    if (!isSafePluginConfigPath(item.path)) {
      toast.error(t('features.config.fileUpload.deleteFailed'));
      return;
    }
    setDirectoryFiles((current) => current.filter((path) => path !== item.path));
    onChange(value.filter((path) => path !== item.path));
    try {
      await deletePluginConfigFile({ path: { plugin_id: pluginName }, body: { path: item.path } });
      toast.success(t('features.config.fileUpload.deleteSuccess'));
    } catch {
      toast.warning(t('features.config.fileUpload.deleteFailed'));
    }
  };

  return <div className="plugin-file-config">
    <button className="button--primary-soft" onClick={() => { setOpen(true); void load(); }} type="button">{t('features.config.fileUpload.button')}</button>
    <small>{t('features.config.fileUpload.fileCount', { count: value.length })}</small>
    <Dialog onOpenChange={setOpen} open={open} title={t('features.config.fileUpload.dialogTitle')}>
      <div className="plugin-file-config__list">
        {!items.length && <p>{t('features.config.fileUpload.empty')}</p>}
        {items.map((item) => <div key={item.path}><MdiIcon name="mdi-file-outline" /><span title={item.path}>{item.path.split('/').pop()}</span>{item.status !== 'ok' && <em>{t(`features.config.fileUpload.${item.status === 'missing' ? 'statusMissing' : 'statusUnconfigured'}`)}</em>}{item.status === 'unconfigured' && <button aria-label={t('features.config.fileUpload.addToConfig')} onClick={() => { onChange([...value, item.path]); toast.success(t('features.config.fileUpload.addToConfig')); }} type="button"><MdiIcon name="mdi-plus" /></button>}<button aria-label={t('features.config.actions.delete')} onClick={() => void remove(item)} type="button"><MdiIcon name="mdi-delete-outline" /></button></div>)}
        <button className="plugin-file-config__drop" disabled={busy} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)); }} type="button"><MdiIcon className={busy ? 'mdi-spin' : ''} name={busy ? 'mdi-loading' : 'mdi-upload'} /><span>{t('features.config.fileUpload.dropzone')}</span>{fileTypes.length > 0 && <small>{t('features.config.fileUpload.allowedTypes', { types: fileTypes.join(', ') })}</small>}</button>
        <input accept={accept || undefined} hidden multiple onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} ref={input} type="file" />
      </div>
      <div className="dialog-actions"><button className="button--primary" onClick={() => setOpen(false)} type="button">{t('features.config.fileUpload.done')}</button></div>
    </Dialog>
  </div>;
}

function ConfigControl({ configKey = '', configRoot, embeddingDimensionLoading, metadata, onChange, onConfigRootChange, onGetEmbeddingDimension, pluginName = '', value }: {
  configKey?: string;
  configRoot: ConfigRecord;
  embeddingDimensionLoading?: boolean;
  metadata: ConfigItemMetadata;
  onChange: (value: unknown) => void;
  onConfigRootChange: (value: ConfigRecord) => void;
  onGetEmbeddingDimension?: () => void;
  pluginName?: string;
  value: unknown;
}) {
  const { t } = useTranslation();
  const type = metadata.type ?? (typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'float' : 'string');
  const disabled = metadata.readonly;
  const translatedLabels = typeof metadata.labels === 'string'
    ? t(`features.config-metadata.${metadata.labels}`, { defaultValue: [], returnObjects: true })
    : metadata.labels;
  const labels = Array.isArray(translatedLabels) ? translatedLabels : [];

  if (isConfigSelectorSpecial(metadata._special)) {
    return <ConfigSpecialSelector disabled={disabled} onChange={onChange} special={String(metadata._special)} value={value} />;
  }

  if (metadata._special === 't2i_template') {
    return <T2ITemplateEditor />;
  }

  if (metadata._special === 'dashboard_totp_manager') {
    return <DashboardTotpManager configRoot={configRoot} onConfigRootChange={onConfigRootChange} value={Boolean(value)} />;
  }

  if (metadata._special === 'get_embedding_dim') {
    return (
      <div className="dynamic-config__embedding-dimension">
        <input disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))} step={1} type="number" value={typeof value === 'number' ? value : 0} />
        <button className="button--primary-soft" disabled={disabled || embeddingDimensionLoading} onClick={onGetEmbeddingDimension} type="button">
          {embeddingDimensionLoading && <MdiIcon name="mdi-loading" />}
          {t('core.common.autoDetect')}
        </button>
      </div>
    );
  }

  if (type === 'file') {
    return <PluginFileConfigControl configKey={configKey} metadata={metadata} onChange={onChange} pluginName={pluginName} value={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []} />;
  }

  if (type === 'bool') {
    return <label className="dynamic-switch"><input checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span className="dynamic-switch__track" /></label>;
  }

  if (metadata.options?.length && type === 'list') {
    const selected = Array.isArray(value) ? value : [];
    if (metadata.render_type === 'checkbox') {
      return <div className="dynamic-config__checks">{metadata.options.map((option, index) => {
        const checked = selected.some((item) => Object.is(item, option));
        return <label key={String(option)}><input checked={checked} disabled={disabled} onChange={() => onChange(checked ? selected.filter((item) => !Object.is(item, option)) : [...selected, option])} type="checkbox" />{String(labels[index] ?? option)}</label>;
      })}</div>;
    }
    return <select disabled={disabled} multiple onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => metadata.options?.[Number(option.value)]))} value={selected.map((item) => String(metadata.options?.findIndex((option) => Object.is(option, item))))}>{metadata.options.map((option, index) => <option key={String(option)} value={index}>{String(labels[index] ?? option)}</option>)}</select>;
  }

  if (metadata.options?.length) {
    const selectedIndex = metadata.options.findIndex((option) => Object.is(option, value));
    return <select disabled={disabled} onChange={(event) => onChange(metadata.options?.[Number(event.target.value)])} value={selectedIndex < 0 ? '' : selectedIndex}><option disabled hidden value="" />{metadata.options.map((option, index) => <option key={String(option)} value={index}>{String(labels[index] ?? option)}</option>)}</select>;
  }

  if (type === 'int' || type === 'float') {
    return <input disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))} step={type === 'int' ? 1 : 'any'} type="number" value={typeof value === 'number' ? value : 0} />;
  }

  if (type === 'text' || metadata.editor_mode) {
    return <textarea disabled={disabled} onChange={(event) => onChange(event.target.value)} rows={4} value={typeof value === 'string' ? value : ''} />;
  }

  if (type === 'list' && (!Array.isArray(value) || value.every((item) => typeof item === 'string'))) {
    return <StringListControl disabled={disabled} onChange={onChange} value={Array.isArray(value) ? value as string[] : []} />;
  }

  if (type === 'dict' || type === 'object' || isConfigRecord(value)) {
    return <ObjectControl disabled={disabled} metadata={metadata} onChange={onChange} value={isConfigRecord(value) ? value : {}} />;
  }

  if (type === 'list' || type === 'template_list' || Array.isArray(value)) {
    return <JsonControl disabled={disabled} onChange={onChange} value={value ?? (type === 'list' ? [] : {})} />;
  }

  return <input disabled={disabled} onChange={(event) => onChange(event.target.value)} type={metadata.secret ? 'password' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} />;
}

type ConfigGroupProps = {
  conditionValue?: ConfigRecord;
  configRoot?: ConfigRecord;
  embeddingDimensionLoading?: boolean;
  fieldsFromValue?: boolean;
  metadata: ConfigGroupMetadata;
  onChange: (value: ConfigRecord) => void;
  onConfigRootChange?: (value: ConfigRecord) => void;
  onGetEmbeddingDimension?: () => void;
  pluginName?: string;
  configPath?: string;
  resolveText?: TextResolver;
  search?: string;
  showValueHint?: boolean;
  title?: string;
  translationPath: string;
  value: ConfigRecord;
  variant?: 'default' | 'inline' | 'settings';
};

const hiddenProviderHints = new Set([
  'provider_group.provider.openai_embedding.hint',
  'provider_group.provider.gemini_embedding.hint',
]);

function resolveValueHint(t: ReturnType<typeof useTranslation>['t'], hint: unknown) {
  if (typeof hint !== 'string' || !hint || hiddenProviderHints.has(hint)) return '';
  const metadataHint = t(`features.config-metadata.${hint}`, { defaultValue: '' });
  if (metadataHint) return metadataHint;
  const directHint = t(hint, { defaultValue: '' });
  return directHint || hint;
}

export function ConfigRichText({ children }: { children: string }) {
  const parts = children.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`]+`|https?:\/\/[^\s，。；、)]+)/g);
  return <>{parts.map((part, index) => {
    const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (markdownLink) return <a href={markdownLink[2]} key={`${part}-${index}`} rel="noreferrer" target="_blank">{markdownLink[1]}</a>;
    if (part.startsWith('http')) return <a href={part} key={`${part}-${index}`} rel="noreferrer" target="_blank">{part}</a>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    return part;
  })}</>;
}

function ValueHint({ children }: { children: string }) {
  return (
    <div className="dynamic-config__value-hint" role="note">
      <MdiIcon name="mdi-information-outline" />
      <p><ConfigRichText>{children}</ConfigRichText></p>
    </div>
  );
}

export function ConfigGroup({ conditionValue, configPath = '', configRoot, embeddingDimensionLoading, fieldsFromValue = false, metadata, onChange, onConfigRootChange, onGetEmbeddingDimension, pluginName, resolveText, search = '', showValueHint = false, title, translationPath, value, variant = 'default' }: ConfigGroupProps) {
  const { t } = useTranslation();
  const textResolver = resolveText ?? defaultTextResolver(t);
  const [showCollapsed, setShowCollapsed] = useState(false);
  const needle = search.trim().toLocaleLowerCase();
  const groupTitle = title ?? textResolver(translationPath, 'description', metadata.description);
  const groupHint = textResolver(translationPath, 'hint', metadata.hint);
  const valueHint = showValueHint ? resolveValueHint(t, value.hint) : '';
  const rootValue = configRoot ?? value;
  const changeRoot = onConfigRootChange ?? onChange;
  const groupMatchesSearch = needle && [metadata.description, metadata.hint, groupTitle, groupHint]
    .some((candidate) => String(candidate ?? '').toLocaleLowerCase().includes(needle));
  const itemMetadata = fieldsFromValue ? configItemsForValue(metadata, value) : metadata.items ?? {};
  const entries = Object.entries(itemMetadata).filter(([key, item]) => {
    if (item.invisible || !matchesConfigCondition(conditionValue ?? value, item)) return false;
    if (!needle || groupMatchesSearch) return true;
    const path = `${translationPath}.${key}`;
    return [
      key,
      item.description,
      item.hint,
      textResolver(path, 'description', item.description),
      textResolver(path, 'hint', item.hint),
    ].some((candidate) => String(candidate ?? '').toLocaleLowerCase().includes(needle));
  });
  const visible = entries.filter(([, item]) => !item.collapsed);
  const collapsed = entries.filter(([, item]) => item.collapsed);

  const renderEntry = ([key, item]: [string, ConfigItemMetadata]) => {
    const path = `${translationPath}.${key}`;
    const label = textResolver(path, 'description', item.description) || key;
    const hint = textResolver(path, 'hint', item.hint);
    const nestedValue = getConfigValue(value, key);
    if (item.type === 'object' && isConfigRecord(item.items) && isConfigRecord(nestedValue)) {
      return (
        <section className="dynamic-config__nested" key={key}>
          <header>
            <h3><ConfigRichText>{label}</ConfigRichText></h3>
            {hint && <p><ConfigRichText>{hint}</ConfigRichText></p>}
          </header>
          <ConfigGroup
            conditionValue={nestedValue}
            configPath={configPath ? `${configPath}.${key}` : key}
            configRoot={rootValue}
            fieldsFromValue
            metadata={item as ConfigGroupMetadata}
            onChange={(next) => onChange(setConfigValue(value, key, next))}
            onConfigRootChange={changeRoot}
            onGetEmbeddingDimension={onGetEmbeddingDimension}
            pluginName={pluginName}
            embeddingDimensionLoading={embeddingDimensionLoading}
            resolveText={textResolver}
            translationPath={path}
            value={nestedValue}
            variant="inline"
          />
        </section>
      );
    }
    const currentValue = getConfigValue(value, key);
    return <Fragment key={key}>
      <div className="dynamic-config__row"><div className="dynamic-config__label"><label htmlFor={`config-${translationPath}-${key}`}><span><ConfigRichText>{label}</ConfigRichText></span><small>{key}</small></label>{hint && <p><ConfigRichText>{hint}</ConfigRichText></p>}</div><div className="dynamic-config__control" id={`config-${translationPath}-${key}`}><ConfigControl configKey={configPath ? `${configPath}.${key}` : key} configRoot={rootValue} embeddingDimensionLoading={embeddingDimensionLoading} metadata={item} onChange={(next) => onChange(setConfigValue(value, key, next))} onConfigRootChange={changeRoot} onGetEmbeddingDimension={onGetEmbeddingDimension} pluginName={pluginName} value={currentValue} /></div></div>
      {item._special === 'select_plugin_set' && Array.isArray(currentValue) && currentValue.length > 0 && <div className="config-plugin-set-preview">
        <small>{t('core.shared.pluginSetSelector.selectedPluginsLabel')}</small>
        <div>{currentValue.filter((plugin): plugin is string => typeof plugin === 'string').map((plugin) => <span key={plugin}>{plugin === '*' ? t('core.shared.pluginSetSelector.allPluginsLabel') : plugin}</span>)}</div>
      </div>}
      {item._special === 'select_persona' && key === 'provider_settings.default_personality' && <PersonaQuickPreview personaId={typeof currentValue === 'string' ? currentValue : ''} />}
    </Fragment>;
  };

  if (!entries.length) return null;
  const form = <section className={`dynamic-config route-card dynamic-config--${variant}`}>{variant === 'default' && <header><h2><ConfigRichText>{groupTitle}</ConfigRichText></h2>{groupHint && <p><ConfigRichText>{groupHint}</ConfigRichText></p>}</header>}{valueHint && <ValueHint>{valueHint}</ValueHint>}{visible.map(renderEntry)}{collapsed.length > 0 && <><button aria-expanded={showCollapsed} className="dynamic-config__more" onClick={() => setShowCollapsed((current) => !current)} type="button">{showCollapsed ? t('core.actions.collapse', 'Collapse') : t('features.config.sections.moreConfig', 'More settings')}</button><ExpandCollapse className="dynamic-config__collapsed" open={showCollapsed}>{collapsed.map(renderEntry)}</ExpandCollapse></>}</section>;
  if (variant === 'settings') return <div className="system-config-group"><h2 className="system-config-group__title">{groupTitle}</h2>{form}</div>;
  return form;
}

function defaultTextResolver(t: ReturnType<typeof useTranslation>['t']): TextResolver {
  return (path, field, fallback = '') => {
    const key = `features.config-metadata.${path}.${field}`;
    const exact = t(key, { defaultValue: '' });
    if (exact) return exact;
    if (!fallback) return '';
    const metadataFallback = t(`features.config-metadata.${fallback}`, { defaultValue: '' });
    if (metadataFallback) return metadataFallback;
    const directFallback = t(fallback, { defaultValue: '' });
    return directFallback || fallback;
  };
}

export function MetadataConfigEditor({ metadata, onChange, search = '', value }: { metadata: ConfigRecord; onChange: (value: ConfigRecord) => void; search?: string; value: ConfigRecord }) {
  const { t } = useTranslation();
  const resolveText = defaultTextResolver(t);
  const allSections = Object.entries(metadata).flatMap(([key, section]) => isConfigRecord(section) && isConfigRecord(section.metadata) ? [{ key, section }] : []);
  const needle = search.trim().toLocaleLowerCase();
  const sections = needle ? allSections.filter(({ key, section }) => {
    return Object.entries(section.metadata as ConfigRecord).some(([groupKey, group]) => {
      if (!isConfigRecord(group)) return false;
      const groupMetadata = group as ConfigGroupMetadata;
      const groupPath = `${key}.${groupKey}`;
      const groupText = [groupKey, groupMetadata.description, groupMetadata.hint, resolveText(groupPath, 'description', groupMetadata.description), resolveText(groupPath, 'hint', groupMetadata.hint)];
      if (groupText.some((candidate) => String(candidate ?? '').toLocaleLowerCase().includes(needle))) return true;
      return Object.entries(groupMetadata.items ?? {}).some(([itemKey, item]) => {
        if (item.invisible || !matchesConfigCondition(value, item)) return false;
        const itemPath = `${groupPath}.${itemKey}`;
        return [itemKey, item.description, item.hint, resolveText(itemPath, 'description', item.description), resolveText(itemPath, 'hint', item.hint)]
          .some((candidate) => String(candidate ?? '').toLocaleLowerCase().includes(needle));
      });
    });
  }) : allSections;
  const [active, setActive] = useState(sections[0]?.key ?? '');
  const current = sections.find((section) => section.key === active) ?? sections[0];

  useEffect(() => {
    if (sections.length && !sections.some((section) => section.key === active)) setActive(sections[0].key);
  }, [active, sections]);

  if (!allSections.length) return <ConfigGroup metadata={inferConfigMetadata(value)} onChange={onChange} resolveText={resolveText} search={search} title="Configuration" translationPath="configuration" value={value} />;
  if (!current) return <div className="dynamic-config-empty">{t('features.config.search.noResult')}</div>;
  return <div className="metadata-config"><nav className="metadata-config__tabs">{sections.map(({ key, section }) => <button aria-pressed={current.key === key} key={key} onClick={() => setActive(key)} type="button">{resolveText(key, 'description', String(section.name ?? key))}</button>)}</nav><div className="metadata-config__content">{Object.entries(current.section.metadata as ConfigRecord).map(([key, group]) => isConfigRecord(group) ? <ConfigGroup key={key} metadata={group as ConfigGroupMetadata} onChange={onChange} resolveText={resolveText} search={search} translationPath={`${current.key}.${key}`} value={value} /> : null)}</div></div>;
}

export function RecordConfigForm({ onChange, value }: { onChange: (value: ConfigRecord) => void; value: ConfigRecord }) {
  const { t } = useTranslation();
  return <ConfigGroup metadata={inferConfigMetadata(value)} onChange={onChange} resolveText={defaultTextResolver(t)} title={t('features.config.editor.visual', 'Form')} translationPath="record" value={value} />;
}
