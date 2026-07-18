import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createT2iTemplate,
  deleteT2iTemplate,
  getActiveT2iTemplate,
  getT2iTemplate,
  listT2iTemplates,
  resetDefaultT2iTemplate,
  setActiveT2iTemplate,
  updateT2iTemplate,
} from '@/api/openapi';
import { authApi } from '@/api/auth';
import { statsApi } from '@/api/compat';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { confirmAction, toast } from '@/stores/feedback';
import { isConfigRecord, setConfigValue, type ConfigRecord } from './configFormModel';

type TemplateSummary = { name: string };
type TotpMode = 'manage' | 'recovery' | 'setup' | 'verify';

const responsePayload = <T,>(response: unknown): T | undefined => {
  if (!isConfigRecord(response)) return undefined;
  const body = isConfigRecord(response.data) ? response.data : response;
  if (isConfigRecord(body) && 'data' in body) return body.data as T;
  return body as T;
};

const responseMessage = (response: unknown, fallback: string) => {
  if (!isConfigRecord(response)) return fallback;
  const body = isConfigRecord(response.data) ? response.data : response;
  return typeof body.message === 'string' && body.message ? body.message : fallback;
};

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

const newTemplateSource = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>New Template</title>
</head>
<body>
  <!-- Start editing here -->
  <article>{{ text | safe }}</article>
</body>
</html>
`;

export function normalizeT2iPreview(content: string, text: string, version: string) {
  let normalized = content.replace(
    /<script\s+id=["']markdown-source["']\s+type=["']text\/plain["']>\s*\{\{\s*text\s*\|\s*safe\s*\}\}\s*<\/script>/gi,
    '<textarea id="markdown-source" hidden>{{ text | safe }}</textarea>',
  );
  normalized = normalized.replace(
    /decodeBase64Utf8\("\{\{\s*text_base64\s*\}\}"\)/g,
    'document.getElementById("markdown-source").value',
  );
  normalized = normalized.replace(
    /document\.getElementById\(["']markdown-source["']\)\.textContent/g,
    'document.getElementById("markdown-source").value',
  );
  normalized = normalized
    .replace(/\{\{\s*text\s*\|\s*safe\s*\}\}/g, () => text)
    .replace(/\{\{\s*version\s*\}\}/g, () => version);
  const runtime = '<script id="astrbot-t2i-shiki-runtime" src="/t2i/shiki_runtime.iife.js"></script>';
  if (normalized.includes('astrbot-t2i-shiki-runtime')) return normalized;
  const placeholder =
    /<script\b[^>]*>\s*\{\{\s*shiki_runtime\s*\|\s*safe\s*\}\}\s*<\/script>|\{\{\s*shiki_runtime\s*\|\s*safe\s*\}\}/gi;
  if (placeholder.test(normalized)) return normalized.replace(placeholder, () => runtime);
  const headClose = normalized.search(/<\/head\s*>/i);
  return headClose >= 0
    ? `${normalized.slice(0, headClose)}${runtime}\n${normalized.slice(headClose)}`
    : `${runtime}\n${normalized}`;
}

export function T2ITemplateEditor() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [active, setActive] = useState('base');
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState('v4.0.0');
  const previewText = t('core.shared.t2iTemplateEditor.previewText');
  const preview = useMemo(() => normalizeT2iPreview(content, previewText, version), [content, previewText, version]);
  const label = useCallback(
    (key: string, options?: Record<string, unknown>) => t(`core.shared.t2iTemplateEditor.${key}`, options),
    [t],
  );

  const loadTemplate = useCallback(
    async (templateName: string) => {
      if (!templateName) return;
      setLoading(true);
      try {
        const data = responsePayload<ConfigRecord>(await getT2iTemplate({ path: { name: templateName } }));
        setContent(typeof data?.content === 'string' ? data.content : '');
      } catch (cause) {
        toast.error(errorText(cause, label('loadTemplateFailed', { name: templateName })));
      } finally {
        setLoading(false);
      }
    },
    [label],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listResponse, activeResponse, versionResponse] = await Promise.all([
        listT2iTemplates(),
        getActiveT2iTemplate(),
        statsApi.version().catch(() => null),
      ]);
      const list = responsePayload<unknown[]>(listResponse) ?? [];
      const nextTemplates = list.flatMap((item) =>
        isConfigRecord(item) && typeof item.name === 'string' ? [{ name: item.name }] : [],
      );
      const activeData = responsePayload<ConfigRecord>(activeResponse);
      const activeName = typeof activeData?.active_template === 'string' ? activeData.active_template : 'base';
      const versionData = responsePayload<ConfigRecord>(versionResponse);
      const rawVersion = typeof versionData?.version === 'string' ? versionData.version : '';
      setTemplates(nextTemplates);
      setActive(activeName);
      setSelected(activeName || nextTemplates[0]?.name || '');
      if (rawVersion) setVersion(rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`);
    } catch (cause) {
      toast.error(errorText(cause, label('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [label]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  useEffect(() => {
    if (open && !creating && selected) void loadTemplate(selected);
  }, [creating, loadTemplate, open, selected]);

  const startNew = () => {
    setCreating(true);
    setName('');
    setSelected('');
    setContent(newTemplateSource);
  };

  const save = async (): Promise<string> => {
    if ((creating && !name.trim()) || (!creating && !selected)) return '';
    setSaving(true);
    try {
      if (creating) {
        const response = await createT2iTemplate({ body: { name: name.trim(), content } });
        const data = responsePayload<ConfigRecord>(response);
        const createdName = typeof data?.name === 'string' ? data.name : name.trim();
        await load();
        setCreating(false);
        setSelected(createdName);
        toast.success(label('saveSuccess'));
        return createdName;
      }
      await updateT2iTemplate({ body: { content }, path: { name: selected } });
      toast.success(label('saveSuccess'));
      return selected;
    } catch (cause) {
      toast.error(errorText(cause, label('saveFailed')));
      return '';
    } finally {
      setSaving(false);
    }
  };

  const apply = async (templateName: string) => {
    try {
      await setActiveT2iTemplate({ body: { name: templateName } });
      setActive(templateName);
      toast.success(label('applySuccess'));
      return true;
    } catch (cause) {
      toast.error(errorText(cause, label('applyFailed')));
      return false;
    }
  };

  const saveAndApply = async () => {
    const templateName = await save();
    if (templateName && (await apply(templateName))) setOpen(false);
  };

  const reset = async () => {
    if (!(await confirmAction(label('confirmResetMessage')))) return;
    setSaving(true);
    try {
      await resetDefaultT2iTemplate();
      await apply('base');
      setCreating(false);
      setSelected('base');
      await loadTemplate('base');
    } catch (cause) {
      toast.error(errorText(cause, label('resetFailed')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || selected === 'base') return;
    if (
      !(await confirmAction({
        danger: true,
        message: label('confirmDeleteMessage', { name: selected }),
        title: label('confirmDelete'),
      }))
    )
      return;
    setSaving(true);
    try {
      await deleteT2iTemplate({ path: { name: selected } });
      if (active === selected) await apply('base');
      await load();
    } catch (cause) {
      toast.error(errorText(cause, label('deleteFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className="config-special-trigger" disabled={loading} onClick={() => setOpen(true)} type="button">
        <MdiIcon name="mdi-code-tags" />
        {label('buttonText')}
      </button>
      <Dialog onOpenChange={setOpen} open={open} title={label('dialogTitle')}>
        <div className="t2i-editor">
          <header className="t2i-editor__toolbar">
            {creating ? (
              <input
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder={label('newTemplateNameLabel')}
                value={name}
              />
            ) : (
              <select disabled={loading} onChange={(event) => setSelected(event.target.value)} value={selected}>
                {templates.map((template) => (
                  <option key={template.name} value={template.name}>
                    {template.name}
                    {template.name === active ? ` · ${label('applied')}` : ''}
                  </option>
                ))}
              </select>
            )}
            <button onClick={startNew} type="button">
              <MdiIcon name="mdi-plus" />
              {label('new')}
            </button>
            <button onClick={() => void reset()} type="button">
              {label('resetBase')}
            </button>
            <button
              className="button--danger-text"
              disabled={creating || selected === 'base' || !selected}
              onClick={() => void remove()}
              type="button"
            >
              {label('delete')}
            </button>
            <button
              className="button--primary-soft"
              disabled={saving || (creating ? !name.trim() : !selected)}
              onClick={() => void save()}
              type="button"
            >
              {label('save')}
            </button>
          </header>
          <div className="t2i-editor__workspace">
            <section>
              <h3>{label('templateEditor')}</h3>
              <MonacoEditor
                language="html"
                onChange={setContent}
                options={{ fontSize: 12, scrollBeyondLastLine: false, wordWrap: 'on' }}
                value={content}
              />
            </section>
            <section>
              <h3>{label('livePreview')}</h3>
              <div className="t2i-editor__preview">
                <iframe sandbox="allow-scripts" srcDoc={preview} title={label('livePreview')} />
              </div>
            </section>
          </div>
          <footer>
            <small>
              <MdiIcon name="mdi-information-outline" />
              {label('syntaxHint')}
            </small>
            <div>
              <button onClick={() => setOpen(false)} type="button">
                {t('core.common.cancel')}
              </button>
              <button
                className="button--primary"
                disabled={creating || !selected || saving}
                onClick={() => void saveAndApply()}
                type="button"
              >
                {label('saveAndApply')}
              </button>
            </div>
          </footer>
        </div>
      </Dialog>
    </>
  );
}

function QrCodeImage({ alt, value }: { alt: string; value: string }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then((next) => {
        if (!cancelled) setSource(next);
      })
      .catch(() => {
        if (!cancelled) setSource('');
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return source ? <img alt={alt} className="totp-manager__qr" src={source} /> : null;
}

export function DashboardTotpManager({
  configRoot,
  onConfigRootChange,
  value,
}: {
  configRoot: ConfigRecord;
  onConfigRootChange: (value: ConfigRecord) => void;
  value: boolean;
}) {
  const { t } = useTranslation();
  const text = useCallback(
    (key: string) => t(`features.config-metadata.system_group.system.dashboard.totp.${key}`),
    [t],
  );
  const dashboard = isConfigRecord(configRoot.dashboard) ? configRoot.dashboard : {};
  const totp = isConfigRecord(dashboard.totp) ? dashboard.totp : {};
  const secret = typeof totp.secret === 'string' ? totp.secret : '';
  const recoveryHash = typeof totp.recovery_code_hash === 'string' ? totp.recovery_code_hash : '';
  const configured = Boolean(value && secret && recoveryHash);
  const [mode, setMode] = useState<TotpMode | null>(null);
  const [step, setStep] = useState<'identity' | 'secret'>('secret');
  const [newSecret, setNewSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pendingTotpConfig, setPendingTotpConfig] = useState<ConfigRecord | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const provisioningUri = (currentSecret: string) =>
    `otpauth://totp/${encodeURIComponent(String(dashboard.username || 'AstrBot'))}?secret=${encodeURIComponent(currentSecret)}&issuer=${encodeURIComponent('AstrBot')}`;

  const close = () => {
    setMode(null);
    setCode('');
    setError('');
    setNewSecret('');
    setAcknowledged(false);
    setPendingTotpConfig(null);
  };

  const fetchSecret = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authApi.setupTotp();
      const data = responsePayload<ConfigRecord>(response);
      setNewSecret(typeof data?.secret === 'string' ? data.secret : '');
      setStep('secret');
      setMode('setup');
    } catch (cause) {
      setError(errorText(cause, text('secretGenerationFailed')));
      setMode('setup');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (enabled: boolean) => {
    if (!enabled) {
      onConfigRootChange(setConfigValue(configRoot, 'dashboard.totp.enable', false));
      close();
    } else if (secret && recoveryHash) {
      onConfigRootChange(setConfigValue(configRoot, 'dashboard.totp.enable', true));
    } else {
      void fetchSecret();
    }
  };

  const verifyIdentity = async () => {
    if (code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const response = await authApi.setupTotp({ code });
      const data = responsePayload<ConfigRecord>(response);
      const nextSecret = typeof data?.secret === 'string' ? data.secret : '';
      if (!nextSecret) throw new Error(responseMessage(response, text('verificationFailed')));
      setNewSecret(nextSecret);
      setCode('');
      setStep('secret');
    } catch (cause) {
      setError(errorText(cause, text('verificationFailed')));
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async () => {
    if (!newSecret || code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const response = await authApi.setupTotp({ code, secret: newSecret });
      const data = responsePayload<ConfigRecord>(response);
      const nextRecoveryCode = typeof data?.recovery_code === 'string' ? data.recovery_code : '';
      const nextRecoveryHash = typeof data?.recovery_code_hash === 'string' ? data.recovery_code_hash : '';
      if (!nextRecoveryCode || !nextRecoveryHash)
        throw new Error(responseMessage(response, text('verificationFailed')));
      let next = setConfigValue(configRoot, 'dashboard.totp.enable', true);
      next = setConfigValue(next, 'dashboard.totp.secret', newSecret);
      next = setConfigValue(next, 'dashboard.totp.recovery_code_hash', nextRecoveryHash);
      setPendingTotpConfig(next);
      setRecoveryCode(nextRecoveryCode);
      setMode('recovery');
      setCode('');
    } catch (cause) {
      setError(errorText(cause, text('verificationFailed')));
    } finally {
      setLoading(false);
    }
  };

  const rotate = () => {
    setStep('identity');
    setCode('');
    setError('');
    setNewSecret('');
    setMode('verify');
  };

  const rotateRecovery = async () => {
    setLoading(true);
    try {
      const response = await authApi.recoverTotp();
      const data = responsePayload<ConfigRecord>(response);
      const nextCode = typeof data?.recovery_code === 'string' ? data.recovery_code : '';
      const nextHash = typeof data?.recovery_code_hash === 'string' ? data.recovery_code_hash : '';
      if (!nextCode || !nextHash) throw new Error(responseMessage(response, text('recoveryGenerationFailed')));
      setPendingTotpConfig(setConfigValue(configRoot, 'dashboard.totp.recovery_code_hash', nextHash));
      setRecoveryCode(nextCode);
      setMode('recovery');
    } catch (cause) {
      toast.error(errorText(cause, text('recoveryGenerationFailed')));
    } finally {
      setLoading(false);
    }
  };

  const finishRecovery = () => {
    if (pendingTotpConfig) onConfigRootChange(pendingTotpConfig);
    close();
  };

  return (
    <div className="totp-manager">
      <label className="dynamic-switch">
        <input checked={value} onChange={(event) => toggle(event.target.checked)} type="checkbox" />
        <span className="dynamic-switch__track" />
      </label>
      {value && (
        <>
          <span className={`totp-manager__status ${configured ? 'is-success' : 'is-warning'}`}>
            <MdiIcon name={configured ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'} />
            {configured ? text('statusEnabled') : text('statusPending')}
          </span>
          <button
            className="button--primary-soft"
            onClick={() => (configured ? setMode('manage') : void fetchSecret())}
            type="button"
          >
            {text('manage')}
          </button>
        </>
      )}
      <Dialog
        onOpenChange={(next) => !next && close()}
        open={mode === 'setup' || mode === 'verify'}
        title={step === 'identity' ? text('identityTitle') : text('setupTitle')}
      >
        <div className="totp-dialog">
          {step === 'identity' ? (
            <>
              <p>{text('identitySubtitle')}</p>
              <label>
                {text('identityCode')}
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  value={code}
                />
              </label>
            </>
          ) : (
            <>
              <p>{text('setupSubtitle')}</p>
              {newSecret && (
                <>
                  <QrCodeImage alt={text('qrCodeAlt')} value={provisioningUri(newSecret)} />
                  <code>{newSecret}</code>
                </>
              )}
              <label>
                {text('rotateCode')}
                <input
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  value={code}
                />
              </label>
            </>
          )}
          {error && <div className="settings-alert settings-alert--error">{error}</div>}
          <DialogActions>
            <Button disabled={loading} onClick={close}>
              {t('core.common.cancel')}
            </Button>
            <Button
              disabled={loading || code.length < 6 || (step === 'secret' && !newSecret)}
              onClick={() => void (step === 'identity' ? verifyIdentity() : confirmSetup())}
              variant="primary"
            >
              {step === 'identity' ? text('identityConfirm') : text('setupConfirm')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
      <Dialog onOpenChange={(next) => !next && close()} open={mode === 'manage'} title={text('configuration')}>
        <div className="totp-dialog">
          <p>{text('activeSubtitle')}</p>
          {secret && (
            <>
              <QrCodeImage alt={text('qrCodeAlt')} value={provisioningUri(secret)} />
              <code>{secret}</code>
            </>
          )}
          <div className="totp-dialog__manage">
            <button className="button--primary-soft" onClick={rotate} type="button">
              <MdiIcon name="mdi-shield-key" />
              {text('rotate')}
            </button>
            <button onClick={() => void rotateRecovery()} type="button">
              <MdiIcon name="mdi-key-variant" />
              {text('rotateRecovery')}
            </button>
          </div>
        </div>
      </Dialog>
      <Dialog onOpenChange={() => undefined} open={mode === 'recovery'} title={text('recoveryTitle')}>
        <div className="totp-dialog">
          <p>{text('recoverySubtitle')}</p>
          <div className="settings-alert settings-alert--warning">{text('recoveryWarning')}</div>
          <code className="totp-dialog__recovery">{recoveryCode}</code>
          <label className="totp-dialog__ack">
            <input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />
            {text('recoveryAcknowledge')}
          </label>
          <DialogActions>
            <Button disabled={!acknowledged} onClick={finishRecovery} variant="primary">
              {text('recoveryClose')}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </div>
  );
}
