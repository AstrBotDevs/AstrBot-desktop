import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';

import {
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
    setOpen(true);
  };
  const save = () => {
    onChange(draft.filter((item) => item.trim() !== ''));
    setOpen(false);
  };

  return <div className="dynamic-list">
    {value.length <= 1
      ? <input disabled={disabled} onChange={(event) => setSingleValue(event.target.value)} value={value[0] ?? ''} />
      : <div className="dynamic-list__preview">{value.slice(0, 2).map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}{value.length > 2 && <span>+{value.length - 2}</span>}</div>}
    {!disabled && <button className="dynamic-list__manage" onClick={showDialog} type="button">{value.length <= 1 ? t('core.common.list.addMore') : t('core.common.list.modifyButton')}</button>}
    <Dialog description={t('core.common.list.inputPlaceholder')} onOpenChange={setOpen} open={open} title={t('core.common.list.editTitle')}>
      <div className="dynamic-list-dialog">
        <div className="dynamic-list-dialog__add"><input onChange={(event) => setNewItem(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }} placeholder={t('core.common.list.addItemPlaceholder')} value={newItem} /><button disabled={!newItem.trim()} onClick={addItem} type="button"><MdiIcon name="mdi-plus" />{t('core.common.list.addButton')}</button></div>
        <div className="dynamic-list-dialog__items">
          {draft.map((item, index) => <div key={index}><input aria-label={`${t('core.common.list.editTitle')} ${index + 1}`} onChange={(event) => setDraft((current) => current.map((entry, itemIndex) => itemIndex === index ? event.target.value : entry))} value={item} /><button aria-label={t('features.config.actions.delete')} onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><MdiIcon name="mdi-delete-outline" /></button></div>)}
          {!draft.length && <p>{t('core.common.list.noItemsHint')}</p>}
        </div>
        <div className="dialog-actions"><button onClick={() => setOpen(false)} type="button">{t('core.common.cancel')}</button><button className="button--primary" onClick={save} type="button">{t('core.common.confirm')}</button></div>
      </div>
    </Dialog>
  </div>;
}

function ConfigControl({ metadata, onChange, value }: { metadata: ConfigItemMetadata; onChange: (value: unknown) => void; value: unknown }) {
  const type = metadata.type ?? (typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'float' : 'string');
  const disabled = metadata.readonly;
  const labels = Array.isArray(metadata.labels) ? metadata.labels : [];

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
    return <select disabled={disabled} onChange={(event) => onChange(metadata.options?.[Number(event.target.value)])} value={selectedIndex < 0 ? '' : selectedIndex}><option disabled value="">—</option>{metadata.options.map((option, index) => <option key={String(option)} value={index}>{String(labels[index] ?? option)}</option>)}</select>;
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

  if (type === 'list' || type === 'dict' || type === 'object' || type === 'template_list' || Array.isArray(value) || isConfigRecord(value)) {
    return <JsonControl disabled={disabled} onChange={onChange} value={value ?? (type === 'list' ? [] : {})} />;
  }

  return <input disabled={disabled} onChange={(event) => onChange(event.target.value)} type={metadata.secret ? 'password' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} />;
}

type ConfigGroupProps = {
  metadata: ConfigGroupMetadata;
  onChange: (value: ConfigRecord) => void;
  resolveText: TextResolver;
  search?: string;
  title?: string;
  translationPath: string;
  value: ConfigRecord;
  variant?: 'default' | 'settings';
};

export function ConfigGroup({ metadata, onChange, resolveText, search = '', title, translationPath, value, variant = 'default' }: ConfigGroupProps) {
  const { t } = useTranslation();
  const [showCollapsed, setShowCollapsed] = useState(false);
  const needle = search.trim().toLocaleLowerCase();
  const groupTitle = title ?? resolveText(translationPath, 'description', metadata.description);
  const groupHint = resolveText(translationPath, 'hint', metadata.hint);
  const groupMatchesSearch = needle && [metadata.description, metadata.hint, groupTitle, groupHint]
    .some((candidate) => String(candidate ?? '').toLocaleLowerCase().includes(needle));
  const entries = Object.entries(metadata.items ?? {}).filter(([key, item]) => {
    if (item.invisible || !matchesConfigCondition(value, item)) return false;
    if (!needle || groupMatchesSearch) return true;
    const path = `${translationPath}.${key}`;
    return [
      key,
      item.description,
      item.hint,
      resolveText(path, 'description', item.description),
      resolveText(path, 'hint', item.hint),
    ].some((candidate) => String(candidate ?? '').toLocaleLowerCase().includes(needle));
  });
  const visible = entries.filter(([, item]) => !item.collapsed);
  const collapsed = entries.filter(([, item]) => item.collapsed);

  const renderEntry = ([key, item]: [string, ConfigItemMetadata]) => {
    const path = `${translationPath}.${key}`;
    const label = resolveText(path, 'description', item.description) || key;
    const hint = resolveText(path, 'hint', item.hint);
    return <div className="dynamic-config__row" key={key}><div className="dynamic-config__label"><label htmlFor={`config-${translationPath}-${key}`}><span>{label}</span><small>{key}</small></label>{hint && <p>{hint}</p>}</div><div className="dynamic-config__control" id={`config-${translationPath}-${key}`}><ConfigControl metadata={item} onChange={(next) => onChange(setConfigValue(value, key, next))} value={getConfigValue(value, key)} /></div></div>;
  };

  if (!entries.length) return null;
  const form = <section className={`dynamic-config route-card dynamic-config--${variant}`}>{variant === 'default' && <header><h2>{groupTitle}</h2>{groupHint && <p>{groupHint}</p>}</header>}{visible.map(renderEntry)}{collapsed.length > 0 && <><button className="dynamic-config__more" onClick={() => setShowCollapsed((current) => !current)} type="button">{showCollapsed ? t('core.actions.collapse', 'Collapse') : t('features.config.sections.moreConfig', 'More settings')}</button>{showCollapsed && collapsed.map(renderEntry)}</>}</section>;
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
