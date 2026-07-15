import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  if (type === 'list' || type === 'dict' || type === 'object' || type === 'template_list' || Array.isArray(value) || isConfigRecord(value)) {
    return <JsonControl disabled={disabled} onChange={onChange} value={value ?? (type === 'list' ? [] : {})} />;
  }

  return <input disabled={disabled} onChange={(event) => onChange(event.target.value)} type={metadata.secret ? 'password' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} />;
}

export function ConfigGroup({ metadata, onChange, resolveText, title, translationPath, value }: { metadata: ConfigGroupMetadata; onChange: (value: ConfigRecord) => void; resolveText: TextResolver; title?: string; translationPath: string; value: ConfigRecord }) {
  const { t } = useTranslation();
  const [showCollapsed, setShowCollapsed] = useState(false);
  const entries = Object.entries(metadata.items ?? {}).filter(([, item]) => !item.invisible && matchesConfigCondition(value, item));
  const visible = entries.filter(([, item]) => !item.collapsed);
  const collapsed = entries.filter(([, item]) => item.collapsed);
  const groupTitle = title ?? resolveText(translationPath, 'description', metadata.description);
  const groupHint = resolveText(translationPath, 'hint', metadata.hint);

  const renderEntry = ([key, item]: [string, ConfigItemMetadata]) => {
    const path = `${translationPath}.${key}`;
    const label = resolveText(path, 'description', item.description) || key;
    const hint = resolveText(path, 'hint', item.hint);
    return <div className="dynamic-config__row" key={key}><div className="dynamic-config__label"><label htmlFor={`config-${translationPath}-${key}`}>{label}<small>{key}</small></label>{hint && <p>{hint}</p>}</div><div className="dynamic-config__control" id={`config-${translationPath}-${key}`}><ConfigControl metadata={item} onChange={(next) => onChange(setConfigValue(value, key, next))} value={getConfigValue(value, key)} /></div></div>;
  };

  if (!entries.length) return null;
  return <section className="dynamic-config route-card"><header><h2>{groupTitle}</h2>{groupHint && <p>{groupHint}</p>}</header>{visible.map(renderEntry)}{collapsed.length > 0 && <><button className="dynamic-config__more" onClick={() => setShowCollapsed((current) => !current)} type="button">{showCollapsed ? t('core.actions.collapse', 'Collapse') : t('features.config.sections.moreConfig', 'More settings')}</button>{showCollapsed && collapsed.map(renderEntry)}</>}</section>;
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

export function MetadataConfigEditor({ metadata, onChange, value }: { metadata: ConfigRecord; onChange: (value: ConfigRecord) => void; value: ConfigRecord }) {
  const { t } = useTranslation();
  const sections = Object.entries(metadata).flatMap(([key, section]) => isConfigRecord(section) && isConfigRecord(section.metadata) ? [{ key, section }] : []);
  const [active, setActive] = useState(sections[0]?.key ?? '');
  const current = sections.find((section) => section.key === active) ?? sections[0];
  const resolveText = defaultTextResolver(t);

  useEffect(() => {
    if (sections.length && !sections.some((section) => section.key === active)) setActive(sections[0].key);
  }, [active, sections]);

  if (!current) return <ConfigGroup metadata={inferConfigMetadata(value)} onChange={onChange} resolveText={resolveText} title="Configuration" translationPath="configuration" value={value} />;
  return <div className="metadata-config"><nav className="metadata-config__tabs">{sections.map(({ key, section }) => <button aria-pressed={current.key === key} key={key} onClick={() => setActive(key)} type="button">{resolveText(key, 'description', String(section.name ?? key))}</button>)}</nav><div className="metadata-config__content">{Object.entries(current.section.metadata as ConfigRecord).map(([key, group]) => isConfigRecord(group) ? <ConfigGroup key={key} metadata={group as ConfigGroupMetadata} onChange={onChange} resolveText={resolveText} translationPath={`${current.key}.${key}`} value={value} /> : null)}</div></div>;
}

export function RecordConfigForm({ onChange, value }: { onChange: (value: ConfigRecord) => void; value: ConfigRecord }) {
  const { t } = useTranslation();
  return <ConfigGroup metadata={inferConfigMetadata(value)} onChange={onChange} resolveText={defaultTextResolver(t)} title={t('features.config.editor.visual', 'Form')} translationPath="record" value={value} />;
}
