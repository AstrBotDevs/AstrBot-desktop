import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { ExpandCollapse } from '@/components/motion/ExpandCollapse';
import { toast } from '@/stores/feedback';
import { ConfigSpecialSelector, isConfigSelectorSpecial, PersonaQuickPreview } from './ConfigSpecialControls';

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

type ObjectValueType = 'boolean' | 'json' | 'number' | 'string';
type ObjectPair = { id: number; jsonError: boolean; key: string; originalKey: string; type: ObjectValueType; value: unknown };

const objectValueType = (value: unknown): ObjectValueType => {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (isConfigRecord(value) || Array.isArray(value)) return 'json';
  return 'string';
};
const normalizedObjectType = (type: unknown): ObjectValueType => {
  if (type === 'bool' || type === 'boolean') return 'boolean';
  if (type === 'int' || type === 'float' || type === 'number') return 'number';
  if (type === 'json' || type === 'dict' || type === 'object' || type === 'list') return 'json';
  return 'string';
};
const objectDraftValue = (value: unknown, type = objectValueType(value)) => type === 'json' ? JSON.stringify(value ?? {}, null, 2) : value;
const defaultObjectValue = (type: ObjectValueType) => type === 'boolean' ? false : type === 'number' ? 0 : type === 'json' ? '{}' : '';

function ObjectControl({ disabled, metadata, onChange, value }: { disabled?: boolean; metadata: ConfigItemMetadata; onChange: (value: unknown) => void; value: ConfigRecord }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<ObjectPair[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<ObjectValueType>('string');
  const keys = Object.keys(value);
  const templateSchema = isConfigRecord(metadata.template_schema) ? metadata.template_schema : {};
  const regularPairs = pairs.filter((pair) => !isConfigRecord(templateSchema[pair.key]));

  const showDialog = () => {
    setPairs(Object.entries(value).map(([key, item], index) => {
      const template: ConfigRecord | null = isConfigRecord(templateSchema[key]) ? templateSchema[key] as ConfigRecord : null;
      const type = template ? normalizedObjectType(template.type) : objectValueType(item);
      return { id: index, jsonError: false, key, originalKey: key, type, value: objectDraftValue(item, type) };
    }));
    setNewKey('');
    setNewType('string');
    setOpen(true);
  };
  const updatePair = (id: number, patch: Partial<ObjectPair>) => setPairs((current) => current.map((pair) => pair.id === id ? { ...pair, ...patch } : pair));
  const removePair = (id: number) => setPairs((current) => current.filter((pair) => pair.id !== id));
  const addPair = () => {
    const key = newKey.trim();
    if (!key) return;
    if (pairs.some((pair) => pair.key === key)) {
      toast.warning(t('core.common.objectEditor.keyExists'));
      return;
    }
    setPairs((current) => [...current, { id: current.reduce((max, pair) => Math.max(max, pair.id), -1) + 1, jsonError: false, key, originalKey: key, type: newType, value: defaultObjectValue(newType) }]);
    setNewKey('');
  };
  const validateKey = (pair: ObjectPair) => {
    const key = pair.key.trim();
    if (!key || pairs.some((item) => item.id !== pair.id && item.key === key)) {
      toast.warning(t('core.common.objectEditor.keyExists'));
      updatePair(pair.id, { key: pair.originalKey });
      return;
    }
    updatePair(pair.id, { key, originalKey: key });
  };
  const save = () => {
    const next: ConfigRecord = {};
    let invalid = false;
    const validated = pairs.map((pair) => {
      if (!pair.key.trim()) return pair;
      try {
        next[pair.key.trim()] = pair.type === 'json'
          ? JSON.parse(String(pair.value))
          : pair.type === 'number'
            ? Number(pair.value)
            : pair.type === 'boolean'
              ? Boolean(pair.value)
              : String(pair.value ?? '');
        return { ...pair, jsonError: false };
      } catch {
        invalid = true;
        return { ...pair, jsonError: true };
      }
    });
    setPairs(validated);
    if (invalid) return;
    onChange(next);
    setOpen(false);
  };
  const renderValue = (pair: ObjectPair) => {
    if (pair.type === 'boolean') return <label className="dynamic-switch"><input checked={Boolean(pair.value)} onChange={(event) => updatePair(pair.id, { value: event.target.checked })} type="checkbox" /><span className="dynamic-switch__track" /></label>;
    return <div className="dynamic-object-dialog__value">
      <input
        aria-invalid={pair.jsonError}
        onBlur={() => {
          if (pair.type !== 'json') return;
          try { JSON.parse(String(pair.value)); updatePair(pair.id, { jsonError: false }); } catch { updatePair(pair.id, { jsonError: true }); }
        }}
        onChange={(event) => updatePair(pair.id, { value: pair.type === 'number' ? event.target.valueAsNumber : event.target.value })}
        placeholder={t(`core.common.objectEditor.placeholders.${pair.type === 'number' ? 'numberValue' : pair.type === 'json' ? 'jsonValue' : 'stringValue'}`)}
        type={pair.type === 'number' ? 'number' : 'text'}
        value={typeof pair.value === 'number' || typeof pair.value === 'string' ? pair.value : ''}
      />
      {pair.jsonError && <small>{t('core.common.objectEditor.invalidJson')}</small>}
    </div>;
  };

  return <div className="dynamic-object">
    <div className="dynamic-object__preview">
      {keys.length
        ? <><span>{keys[0]}</span>{keys.length > 1 && <span>+{keys.length - 1}</span>}</>
        : <em>{t('core.common.objectEditor.noItems')}</em>}
    </div>
    {!disabled && <button className="dynamic-object__manage" onClick={showDialog} type="button">{t('core.common.list.modifyButton')}</button>}
    <Dialog onOpenChange={setOpen} open={open} title={t('core.common.objectEditor.dialogTitle')}>
      <div className="dynamic-object-dialog">
        <div className="dynamic-object-dialog__body">
          {regularPairs.map((pair) => <div className="dynamic-object-dialog__pair" key={pair.id}>
            <input onBlur={() => validateKey(pair)} onChange={(event) => updatePair(pair.id, { key: event.target.value })} placeholder={t('core.common.objectEditor.placeholders.keyName')} value={pair.key} />
            {renderValue(pair)}
            <button aria-label={t('features.config.actions.delete')} onClick={() => removePair(pair.id)} type="button"><MdiIcon name="mdi-delete" /></button>
          </div>)}
          {Object.entries(templateSchema).length > 0 && <div className="dynamic-object-dialog__templates">
            <span>{t('core.common.objectEditor.presets')}</span>
            {Object.entries(templateSchema).map(([key, rawTemplate]) => {
              if (!isConfigRecord(rawTemplate)) return null;
              const pair = pairs.find((item) => item.key === key);
              const type = normalizedObjectType(rawTemplate.type);
              const temporary: ObjectPair = pair ?? { id: -1, jsonError: false, key, originalKey: key, type, value: objectDraftValue(rawTemplate.default ?? defaultObjectValue(type), type) };
              const updateTemplate = (patch: Partial<ObjectPair>) => {
                if (pair) updatePair(pair.id, patch);
                else setPairs((current) => [...current, { ...temporary, ...patch, id: current.reduce((max, item) => Math.max(max, item.id), -1) + 1 }]);
              };
              return <div className={`dynamic-object-dialog__template${pair ? '' : ' is-inactive'}`} key={key}>
                <div><strong>{String(rawTemplate.name || rawTemplate.description || key)}</strong>{Boolean(rawTemplate.hint) && <small>{String(rawTemplate.hint)}</small>}</div>
                <div onChangeCapture={() => undefined}>{pair ? renderValue(pair) : type === 'boolean'
                  ? <label className="dynamic-switch"><input checked={Boolean(temporary.value)} onChange={(event) => updateTemplate({ value: event.target.checked })} type="checkbox" /><span className="dynamic-switch__track" /></label>
                  : <input onChange={(event) => updateTemplate({ value: type === 'number' ? event.target.valueAsNumber : event.target.value })} type={type === 'number' ? 'number' : 'text'} value={typeof temporary.value === 'string' || typeof temporary.value === 'number' ? temporary.value : ''} />}</div>
                {pair ? <button aria-label={t('features.config.actions.delete')} onClick={() => removePair(pair.id)} type="button"><MdiIcon name="mdi-close" /></button> : <span />}
              </div>;
            })}
          </div>}
          {!regularPairs.length && !Object.keys(templateSchema).length && <div className="dynamic-editor-empty"><MdiIcon name="mdi-code-json" /><p>{t('core.common.objectEditor.noParams')}</p></div>}
        </div>
        <div className="dynamic-object-dialog__add">
          <input onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPair(); } }} placeholder={t('core.common.objectEditor.newKeyLabel')} value={newKey} />
          <label><span>{t('core.common.objectEditor.valueTypeLabel')}</span><select onChange={(event) => setNewType(event.target.value as ObjectValueType)} value={newType}><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="json">json</option></select></label>
          <button className="dynamic-editor-button--tonal" disabled={!newKey.trim()} onClick={addPair} type="button"><MdiIcon name="mdi-plus" />{t('core.common.add')}</button>
        </div>
        <div className="dialog-actions"><button onClick={() => setOpen(false)} type="button">{t('core.common.cancel')}</button><button className="button--primary" onClick={save} type="button">{t('core.common.confirm')}</button></div>
      </div>
    </Dialog>
  </div>;
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

function ConfigControl({ embeddingDimensionLoading, metadata, onChange, onGetEmbeddingDimension, value }: {
  embeddingDimensionLoading?: boolean;
  metadata: ConfigItemMetadata;
  onChange: (value: unknown) => void;
  onGetEmbeddingDimension?: () => void;
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
  embeddingDimensionLoading?: boolean;
  fieldsFromValue?: boolean;
  metadata: ConfigGroupMetadata;
  onChange: (value: ConfigRecord) => void;
  onGetEmbeddingDimension?: () => void;
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

function ValueHint({ children }: { children: string }) {
  const parts = children.split(/(https?:\/\/[^\s，。；、]+)/g);
  return (
    <div className="dynamic-config__value-hint" role="note">
      <MdiIcon name="mdi-information-outline" />
      <p>{parts.map((part, index) => part.startsWith('http')
        ? <a href={part} key={`${part}-${index}`} rel="noreferrer" target="_blank">{part}</a>
        : part)}</p>
    </div>
  );
}

export function ConfigGroup({ conditionValue, embeddingDimensionLoading, fieldsFromValue = false, metadata, onChange, onGetEmbeddingDimension, resolveText, search = '', showValueHint = false, title, translationPath, value, variant = 'default' }: ConfigGroupProps) {
  const { t } = useTranslation();
  const textResolver = resolveText ?? defaultTextResolver(t);
  const [showCollapsed, setShowCollapsed] = useState(false);
  const needle = search.trim().toLocaleLowerCase();
  const groupTitle = title ?? textResolver(translationPath, 'description', metadata.description);
  const groupHint = textResolver(translationPath, 'hint', metadata.hint);
  const valueHint = showValueHint ? resolveValueHint(t, value.hint) : '';
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
            <h3>{label}</h3>
            {hint && <p>{hint}</p>}
          </header>
          <ConfigGroup
            conditionValue={nestedValue}
            fieldsFromValue
            metadata={item as ConfigGroupMetadata}
            onChange={(next) => onChange(setConfigValue(value, key, next))}
            onGetEmbeddingDimension={onGetEmbeddingDimension}
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
      <div className="dynamic-config__row"><div className="dynamic-config__label"><label htmlFor={`config-${translationPath}-${key}`}><span>{label}</span><small>{key}</small></label>{hint && <p>{hint}</p>}</div><div className="dynamic-config__control" id={`config-${translationPath}-${key}`}><ConfigControl embeddingDimensionLoading={embeddingDimensionLoading} metadata={item} onChange={(next) => onChange(setConfigValue(value, key, next))} onGetEmbeddingDimension={onGetEmbeddingDimension} value={currentValue} /></div></div>
      {item._special === 'select_plugin_set' && Array.isArray(currentValue) && currentValue.length > 0 && <div className="config-plugin-set-preview">
        <small>{t('core.shared.pluginSetSelector.selectedPluginsLabel')}</small>
        <div>{currentValue.filter((plugin): plugin is string => typeof plugin === 'string').map((plugin) => <span key={plugin}>{plugin === '*' ? t('core.shared.pluginSetSelector.allPluginsLabel') : plugin}</span>)}</div>
      </div>}
      {item._special === 'select_persona' && key === 'provider_settings.default_personality' && <PersonaQuickPreview personaId={typeof currentValue === 'string' ? currentValue : ''} />}
    </Fragment>;
  };

  if (!entries.length) return null;
  const form = <section className={`dynamic-config route-card dynamic-config--${variant}`}>{variant === 'default' && <header><h2>{groupTitle}</h2>{groupHint && <p>{groupHint}</p>}</header>}{valueHint && <ValueHint>{valueHint}</ValueHint>}{visible.map(renderEntry)}{collapsed.length > 0 && <><button aria-expanded={showCollapsed} className="dynamic-config__more" onClick={() => setShowCollapsed((current) => !current)} type="button">{showCollapsed ? t('core.actions.collapse', 'Collapse') : t('features.config.sections.moreConfig', 'More settings')}</button><ExpandCollapse className="dynamic-config__collapsed" open={showCollapsed}>{collapsed.map(renderEntry)}</ExpandCollapse></>}</section>;
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
