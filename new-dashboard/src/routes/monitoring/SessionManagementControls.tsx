import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MdiIcon } from '@/components/icons/MdiIcon';
import {
  FOLLOW_CONFIG_VALUE,
  sessionDisplayName,
  type ProviderOption,
  type UmoInfo,
} from './sessionManagementModel';

export function UmoDisplay({
  compact = false,
  customName,
  info,
  onEdit,
}: {
  compact?: boolean;
  customName?: string;
  info: UmoInfo;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  return <div className={`session-umo${compact ? ' session-umo--compact' : ''}`}>
    <div className="session-umo__title">
      <strong>{sessionDisplayName(info, customName)}</strong>
      {onEdit && <button aria-label={t('features.session-management.buttons.edit')} onClick={onEdit} type="button"><MdiIcon name="mdi-pencil-outline" /></button>}
    </div>
    {!compact && <div className="session-umo__meta">
      {info.platform && <span>{info.platform}</span>}
      {info.message_type && <span>{info.message_type}</span>}
      <code title={info.umo}>{info.session_id || info.umo}</code>
    </div>}
  </div>;
}

export function EditorSection({ children, onSave, saveText, saving, title }: {
  children: ReactNode;
  onSave: () => Promise<void>;
  saveText: string;
  saving: boolean;
  title: string;
}) {
  return <section className="session-editor-section"><h3>{title}</h3><div className="session-editor-section__fields">{children}</div><div className="session-editor-section__actions"><button disabled={saving} onClick={() => void onSave()} type="button"><MdiIcon className={saving ? 'mdi-spin' : ''} name={saving ? 'mdi-loading' : 'mdi-content-save'} />{saveText}</button></div></section>;
}

export function ProviderSelect({ disabled, followText, label, onChange, options, value }: {
  disabled?: boolean;
  followText: string;
  label: string;
  onChange: (value: string) => void;
  options: ProviderOption[];
  value: string;
}) {
  return <label><span>{label}</span><select disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}><option value={FOLLOW_CONFIG_VALUE}>{followText}</option>{options.map((provider) => <option key={provider.id} value={provider.id}>{provider.model ? `${provider.name || provider.id} (${provider.model})` : provider.name || provider.id}</option>)}</select></label>;
}

export function MultiSelect({ disabled, label, onChange, options, value }: {
  disabled?: boolean;
  label: string;
  onChange: (value: string[]) => void;
  options: { label: string; value: string }[];
  value: string[];
}) {
  return <label className="session-multi-select"><span>{label}</span><select disabled={disabled} multiple onChange={(event) => onChange([...event.currentTarget.selectedOptions].map((option) => option.value))} value={value}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{value.length > 0 && <div>{value.map((item) => <button key={item} onClick={() => onChange(value.filter((valueItem) => valueItem !== item))} type="button">{options.find((option) => option.value === item)?.label || item}<MdiIcon name="mdi-close" /></button>)}</div>}</label>;
}

export function TransferList({ danger, emptyText, icon, infoFor, items, label, onItem, onSearch, search }: {
  danger?: boolean;
  emptyText: string;
  icon: `mdi-${string}`;
  infoFor: (umo: string) => UmoInfo;
  items: string[];
  label: string;
  onItem: (umo: string) => void;
  onSearch: (value: string) => void;
  search: string;
}) {
  const { t } = useTranslation();
  return <div className="session-transfer-list"><strong>{label}</strong><label className="session-transfer-list__search"><MdiIcon name="mdi-magnify" /><input onChange={(event) => onSearch(event.target.value)} placeholder={t('features.session-management.groups.searchPlaceholder')} value={search} /></label><div className="session-transfer-list__items">{items.map((umo) => <button className={danger ? 'is-danger' : ''} key={umo} onClick={() => onItem(umo)} type="button"><MdiIcon name={icon} /><UmoDisplay compact info={infoFor(umo)} /><span>{infoFor(umo).platform}</span></button>)}{!items.length && <div>{emptyText}</div>}</div></div>;
}
