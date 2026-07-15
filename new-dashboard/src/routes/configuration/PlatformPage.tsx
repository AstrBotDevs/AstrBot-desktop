import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createBot, deleteBotById, getSystemConfigRuntime, listBotStats, setBotEnabledById, updateBotById } from '@/api/openapi';
import { ConfigGroup } from '@/components/config/DynamicConfigForm';
import type { ConfigGroupMetadata, ConfigRecord } from '@/components/config/configFormModel';
import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { i18n } from '@/i18n';
import { confirmAction, toast } from '@/stores/feedback';
import { errorMessage, isObject, JsonObject, objectList, recordId, responseData } from './model';
import { isValidPlatformId, mergePlatformTemplate, platformFormMetadata, platformQrPayload, platformTemplates, readPlatformRuntime, webhookUrl } from './platformModel';

type EditorState = { config: JsonObject; originalId: string } | null;

export default function PlatformPage() {
  const { t } = useTranslation();
  const tm = useCallback((key: string, options?: Record<string, unknown>) => t(`features.platform.${key}`, options), [t]);
  const [config, setConfig] = useState<JsonObject>({});
  const [metadata, setMetadata] = useState<JsonObject>({});
  const [stats, setStats] = useState(new Map<string, JsonObject>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const [selectedType, setSelectedType] = useState('');
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState<{ kind: 'error' | 'qr' | 'webhook'; item: JsonObject; stat?: JsonObject } | null>(null);

  const loadConfig = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const runtime = readPlatformRuntime(responseData(await getSystemConfigRuntime()));
      setConfig(runtime.config);
      setMetadata(runtime.metadata);
      if (runtime.translations) {
        for (const [locale, resources] of Object.entries(runtime.translations)) {
          i18n.addResourceBundle(locale, 'translation', { features: { 'config-metadata': resources } }, true, true);
        }
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Failed to load platforms.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const next = new Map<string, JsonObject>();
      objectList(responseData(await listBotStats()), ['platforms']).forEach((item) => next.set(recordId(item, 'id', 'bot_id'), item));
      setStats(next);
    } catch { /* Runtime statistics are supplementary. */ }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadStats();
    const timer = window.setInterval(() => void loadStats(), 5_000);
    const localeChanged = () => void loadConfig(true);
    window.addEventListener('astrbot-locale-changed', localeChanged);
    return () => { window.clearInterval(timer); window.removeEventListener('astrbot-locale-changed', localeChanged); };
  }, [loadConfig, loadStats]);

  const items = objectList(config.platform, []);
  const templates = useMemo(() => platformTemplates(metadata), [metadata]);
  const formMetadata = useMemo(() => platformFormMetadata(metadata), [metadata]);

  const openCreate = () => {
    const first = Object.keys(templates)[0] || '';
    setSelectedType(first);
    setEditor({ config: first ? mergePlatformTemplate({}, templates[first]) : { id: '', type: '', enable: true }, originalId: '' });
  };
  const openEdit = (item: JsonObject) => {
    const type = String(item.type || '');
    setSelectedType(type);
    setEditor({ config: mergePlatformTemplate(item, templates[type]), originalId: recordId(item, 'id', 'bot_id') });
  };
  const chooseType = (type: string) => {
    setSelectedType(type);
    setEditor({ config: mergePlatformTemplate({}, templates[type]), originalId: '' });
  };

  const save = async () => {
    if (!editor) return;
    const id = recordId(editor.config, 'id', 'bot_id');
    const type = String(editor.config.type || selectedType);
    if (!isValidPlatformId(id)) { toast.warning(tm('dialog.invalidPlatformId')); return; }
    if (!type) { toast.warning(tm('createDialog.platformTypeLabel')); return; }
    if (!editor.originalId && items.some((item) => recordId(item, 'id', 'bot_id') === id)) { toast.warning(tm('dialog.idConflict.message', { id })); return; }
    setSaving(true);
    try {
      if (editor.originalId) await updateBotById({ body: { bot_id: editor.originalId, config: editor.config } });
      else await createBot({ body: { id, type, enabled: editor.config.enable !== false, config: editor.config } });
      toast.success(tm(editor.originalId ? 'messages.updateSuccess' : 'messages.addSuccess'));
      setEditor(null);
      await Promise.all([loadConfig(true), loadStats()]);
    } catch (cause) { toast.error(errorMessage(cause, tm('messages.platformUpdateFailed'))); }
    finally { setSaving(false); }
  };

  const toggle = async (item: JsonObject) => {
    const id = recordId(item, 'id', 'bot_id');
    if (!id) return;
    try {
      await setBotEnabledById({ body: { bot_id: id, enabled: (item.enable ?? item.enabled) === false } });
      toast.success(tm('messages.statusUpdateSuccess'));
      await loadConfig(true);
    } catch (cause) { toast.error(errorMessage(cause, tm('messages.platformUpdateFailed'))); }
  };

  const remove = async (item: JsonObject) => {
    const id = recordId(item, 'id', 'bot_id');
    if (!id || !await confirmAction({ danger: true, title: tm('messages.deleteConfirm'), message: `${tm('messages.deleteConfirm')} ${id}?` })) return;
    try {
      await deleteBotById({ query: { bot_id: id } });
      toast.success(tm('messages.deleteSuccess'));
      await loadConfig(true);
    } catch (cause) { toast.error(errorMessage(cause, tm('messages.platformUpdateFailed'))); }
  };

  return (
    <div className="platform-page-react">
      <header className="platform-page-react__header">
        <div className="platform-page-react__heading"><MdiIcon name="mdi-robot" /><div><h1>{tm('title')}</h1><p>{tm('subtitle')}</p></div></div>
        <button className="platform-primary-button" onClick={openCreate} type="button"><MdiIcon name="mdi-plus" />{tm('addAdapter')}</button>
      </header>

      {loading && <div className="monitor-loading" role="status">Loading…</div>}
      {error && <div className="monitor-error" role="alert">{error}</div>}
      {!loading && !items.length && <div className="platform-empty"><MdiIcon name="mdi-connection" size={58} /><p>{tm('emptyText')}</p></div>}
      <section className="platform-grid">
        {items.map((item, index) => <PlatformCard config={config} item={item} key={recordId(item, 'id', 'bot_id') || index} onDetails={setDetails} onEdit={openEdit} onRemove={(value) => void remove(value)} onToggle={(value) => void toggle(value)} stat={stats.get(recordId(item, 'id', 'bot_id'))} t={tm} />)}
      </section>

      <PlatformEditor editor={editor} formMetadata={formMetadata} onChange={(next) => setEditor((current) => current ? { ...current, config: next } : current)} onOpenChange={(open) => !open && setEditor(null)} onSave={() => void save()} onTypeChange={chooseType} saving={saving} selectedType={selectedType} t={tm} templates={templates} />
      <DetailsDialog config={config} details={details} onOpenChange={(open) => !open && setDetails(null)} t={tm} />
    </div>
  );
}

function PlatformCard({ config, item, onDetails, onEdit, onRemove, onToggle, stat, t }: { config: JsonObject; item: JsonObject; onDetails: (details: { kind: 'error' | 'qr' | 'webhook'; item: JsonObject; stat?: JsonObject }) => void; onEdit: (item: JsonObject) => void; onRemove: (item: JsonObject) => void; onToggle: (item: JsonObject) => void; stat?: JsonObject; t: (key: string, options?: Record<string, unknown>) => string }) {
  const id = recordId(item, 'id', 'bot_id');
  const enabled = (item.enable ?? item.enabled) !== false;
  const status = String(stat?.status || (enabled ? 'running' : 'stopped'));
  const errors = Number(stat?.error_count || 0);
  const qr = platformQrPayload(stat);
  const webhook = Boolean(stat?.unified_webhook && item.webhook_uuid);
  return <article className="platform-card">
    <div className="platform-card__watermark"><MdiIcon name={platformIcon(String(item.type || id))} /></div>
    <header><span className="platform-card__icon"><MdiIcon name={platformIcon(String(item.type || id))} /></span><div><h2>{id}</h2><p>{String(item.type || 'unknown')}</p></div><label className="provider-switch" title={enabled ? t('status.enabled') : t('status.disabled')}><input checked={enabled} onChange={() => onToggle(item)} type="checkbox" /><span /></label></header>
    <div className="platform-card__badges">
      {status !== 'running' && <button className={`platform-badge platform-badge--${status}`} type="button"><MdiIcon name={statusIcon(status)} />{t(`runtimeStatus.${status === 'error' || status === 'pending' || status === 'stopped' ? status : 'unknown'}`)}</button>}
      {errors > 0 && <button className="platform-badge platform-badge--error" onClick={() => onDetails({ kind: 'error', item, stat })} type="button"><MdiIcon name="mdi-bug" />{errors} {t('runtimeStatus.errors')}</button>}
      {qr && <button className="platform-badge" onClick={() => onDetails({ kind: 'qr', item, stat })} type="button"><MdiIcon name="mdi-qrcode" />{t('platformQr.show')}</button>}
      {webhook && <button className="platform-badge" onClick={() => onDetails({ kind: 'webhook', item, stat })} title={webhookUrl(config, String(item.webhook_uuid))} type="button"><MdiIcon name="mdi-webhook" />{t('viewWebhook')}</button>}
    </div>
    <footer><button onClick={() => onEdit(item)} type="button"><MdiIcon name="mdi-pencil-outline" />{t('dialog.edit')}</button><button className="button--danger" onClick={() => onRemove(item)} type="button"><MdiIcon name="mdi-delete-outline" /></button></footer>
  </article>;
}

function PlatformEditor({ editor, formMetadata, onChange, onOpenChange, onSave, onTypeChange, saving, selectedType, t, templates }: { editor: EditorState; formMetadata: JsonObject; onChange: (next: JsonObject) => void; onOpenChange: (open: boolean) => void; onSave: () => void; onTypeChange: (type: string) => void; saving: boolean; selectedType: string; t: (key: string, options?: Record<string, unknown>) => string; templates: Record<string, JsonObject> }) {
  const resolveText = (path: string, field: 'description' | 'hint', fallback = '') => {
    const exact = i18n.t(`features.config-metadata.${path}.${field}`, { defaultValue: '' });
    if (exact) return exact;
    if (!fallback) return '';
    return i18n.t(`features.config-metadata.${fallback}`, { defaultValue: fallback });
  };
  const editing = Boolean(editor?.originalId);
  return <Dialog description={t('createDialog.step1Hint')} onOpenChange={onOpenChange} open={editor !== null} title={editing ? `${t('dialog.edit')} ${editor?.originalId} ${t('dialog.adapter')}` : t('dialog.addPlatform')}>
    {editor && <div className="platform-editor">
      {!editing && <label className="platform-editor__type"><span>{t('createDialog.platformTypeLabel')}</span><select onChange={(event) => onTypeChange(event.target.value)} value={selectedType}><option value="">—</option>{Object.keys(templates).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
      {selectedType && <a className="platform-tutorial" href={tutorialLink(selectedType)} rel="noreferrer" target="_blank"><MdiIcon name="mdi-book-open-variant" />{t('dialog.viewTutorial')}</a>}
      {isObject(formMetadata) && Object.keys(formMetadata).length > 0
        ? <div className="dynamic-config-dialog"><ConfigGroup metadata={formMetadata as ConfigGroupMetadata} onChange={(next: ConfigRecord) => onChange(next)} resolveText={resolveText} title={t('adapters')} translationPath="platform_group.platform" value={editor.config} /></div>
        : <FallbackPlatformForm config={editor.config} onChange={onChange} />}
      <div className="dialog-actions"><DialogClose asChild><button type="button">{t('dialog.cancel')}</button></DialogClose><button className="button--primary" disabled={saving} onClick={onSave} type="button">{saving ? '…' : t('dialog.save')}</button></div>
    </div>}
  </Dialog>;
}

function FallbackPlatformForm({ config, onChange }: { config: JsonObject; onChange: (next: JsonObject) => void }) {
  return <div className="dialog-form"><label>ID<input onChange={(event) => onChange({ ...config, id: event.target.value })} value={String(config.id || '')} /></label><label>Type<input onChange={(event) => onChange({ ...config, type: event.target.value })} value={String(config.type || '')} /></label></div>;
}

function DetailsDialog({ config, details, onOpenChange, t }: { config: JsonObject; details: { kind: 'error' | 'qr' | 'webhook'; item: JsonObject; stat?: JsonObject } | null; onOpenChange: (open: boolean) => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  const kind = details?.kind;
  const qr = platformQrPayload(details?.stat);
  const uuid = String(details?.item.webhook_uuid || '');
  const url = webhookUrl(config, uuid);
  const lastError = isObject(details?.stat?.last_error) ? details?.stat?.last_error as JsonObject : null;
  const title = kind === 'qr' ? t('platformQr.title') : kind === 'webhook' ? t('webhookDialog.title') : t('errorDialog.title');
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success(t('webhookCopied')); } catch { toast.error(t('webhookCopyFailed')); } };
  return <Dialog onOpenChange={onOpenChange} open={details !== null} title={title}>
    {kind === 'webhook' && <div className="platform-detail"><p>{t('webhookDialog.description')}</p><div className="platform-webhook"><input readOnly value={url} /><button onClick={() => void copy()} type="button"><MdiIcon name="mdi-content-copy" /></button></div></div>}
    {kind === 'qr' && <div className="platform-detail platform-detail--qr"><p>{t('platformQr.status')}: {qr?.status || t('platformQr.waiting')}</p>{qr && <img alt={t('platformQr.title')} src={qr.payload} />}</div>}
    {kind === 'error' && <div className="platform-detail"><p><strong>{t('errorDialog.platformId')}:</strong> {recordId(details?.item ?? {}, 'id')}</p><p><strong>{t('errorDialog.errorCount')}:</strong> {String(details?.stat?.error_count || 0)}</p>{lastError && <><div className="platform-error-message">{String(lastError.message || '')}<small>{lastError.timestamp ? `${t('errorDialog.occurredAt')}: ${new Date(String(lastError.timestamp)).toLocaleString()}` : ''}</small></div>{lastError.traceback && <pre className="platform-traceback">{String(lastError.traceback)}</pre>}</>}</div>}
    <div className="dialog-actions"><DialogClose asChild><button type="button">{kind === 'qr' ? t('platformQr.close') : kind === 'webhook' ? t('webhookDialog.close') : t('errorDialog.close')}</button></DialogClose></div>
  </Dialog>;
}

function platformIcon(type: string): `mdi-${string}` {
  if (/telegram/i.test(type)) return 'mdi-send-outline';
  if (/discord|slack|lark|dingtalk/i.test(type)) return 'mdi-chat-processing';
  if (/weixin|wechat|wecom/i.test(type)) return 'mdi-message-text';
  if (/qq|onebot|aiocqhttp/i.test(type)) return 'mdi-chat';
  return 'mdi-robot-outline';
}

function statusIcon(status: string): `mdi-${string}` {
  if (status === 'error') return 'mdi-alert-circle';
  if (status === 'pending') return 'mdi-clock-outline';
  if (status === 'stopped') return 'mdi-stop-circle';
  return 'mdi-help-circle';
}

function tutorialLink(type: string) {
  const links: Record<string, string> = { qq_official_webhook: 'qqofficial/webhook.html', qq_official: 'qqofficial/websockets.html', aiocqhttp: 'aiocqhttp.html', wecom: 'wecom.html', weixin_oc: 'weixin_oc.html', wecom_ai_bot: 'wecom_ai_bot.html', lark: 'lark.html', telegram: 'telegram.html', dingtalk: 'dingtalk.html', weixin_official_account: 'weixin-official-account.html', discord: 'discord.html', slack: 'slack.html', kook: 'kook.html', vocechat: 'vocechat.html', satori: 'satori/guide.html', misskey: 'misskey.html', line: 'line.html', matrix: 'matrix.html', mattermost: 'mattermost.html' };
  return `https://docs.astrbot.app/platform/${links[type] || ''}`;
}
