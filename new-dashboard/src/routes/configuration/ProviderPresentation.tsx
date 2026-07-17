import { useState } from 'react';
import type { TFunction } from 'i18next';

import { MdiIcon } from '@/components/icons/MdiIcon';
import type { JsonObject } from './model';
import { recordId } from './model';
import { getProviderIcon } from './providerIcons';
import {
  capabilityBadges,
  formatContextLimit,
  type ProviderTestStatus,
} from './providerPageModel';

export function providerTemplateDescription(template: JsonObject, name: string, t: TFunction) {
  if (name === 'OpenAI') return t('features.provider.providers.description.openai', { type: String(template.type || '') });
  if (template.provider === 'kimi-code') return t('features.provider.providers.description.kimi_code');
  if (name === 'vLLM Rerank') return t('features.provider.providers.description.vllm_rerank', { type: String(template.type || '') });
  return t('features.provider.providers.description.default', { type: String(template.type || '') });
}

export function ProviderRow({ metadata, onDelete, onEdit, onTest, onToggle, provider, status, t, testing }: {
  metadata?: JsonObject;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  provider: JsonObject;
  status?: ProviderTestStatus;
  t: TFunction;
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

export function ProviderModelCopy({ metadata, model, provider, t }: { metadata?: JsonObject; model: string; provider: JsonObject; t: TFunction }) {
  return (
    <div className="provider-model-row__copy">
      <ProviderMark provider={String(provider.provider || '')} />
      <span><strong>{recordId(provider, 'id') || model}</strong><small><span>{model}</span><span className="provider-model-badges">{capabilityBadges(provider, metadata).map((badge) => <MdiIcon className={badge.enabled ? '' : 'is-disabled'} key={badge.key} name={badge.icon} />)}{formatContextLimit(provider, metadata) && <b title={t('features.provider.models.metadata.context', { tokens: formatContextLimit(provider, metadata) })}>{formatContextLimit(provider, metadata)}</b>}</span></small></span>
    </div>
  );
}

export function ProviderCard({ onCopy, onDelete, onEdit, onTest, onToggle, provider, status, t, testing }: {
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  provider: JsonObject;
  status?: ProviderTestStatus;
  t: TFunction;
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

function ProviderStatus({ status, t }: { status: ProviderTestStatus; t: TFunction }) {
  return <span className={`provider-test-status provider-test-status--${status.status}`} title={status.error || undefined}>
    <MdiIcon name={status.status === 'available' ? 'mdi-check-circle' : status.status === 'pending' ? 'mdi-loading' : 'mdi-alert-circle'} />
    {t(`features.provider.availability.${status.status}`)}
    {status.error && <small>{status.error}</small>}
  </span>;
}

export function ProviderMark({ provider, variant = 'source' }: { provider: string; variant?: 'menu' | 'source' }) {
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

export function providerEnabled(provider: JsonObject) {
  return (provider.enable ?? provider.enabled) !== false;
}

export function cloneProviderObject(value: JsonObject) {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
