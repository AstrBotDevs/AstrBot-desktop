import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  checkPluginVersionSupport,
  installPluginFromGithub,
  installPluginFromUpload,
  installPluginFromUrl,
  validatePluginRepo,
} from '@/api/openapi';
import type { PluginDto } from '@/api/domain';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { ProxySelector } from '@/routes/configuration/SettingsExtras';
import { errorMessage, isObject, type JsonObject, responseData } from '@/routes/configuration/model';
import { toast } from '@/stores/feedback';
import { getSelectedGitHubProxy } from './extensionActions';
import { pluginAuthor, pluginDescription, pluginInstallUrl, pluginTitle } from './extensionModel';

export function InstallPluginDialog({
  initial,
  onInstalled,
  onOpenChange,
  open,
  registryUrl = '',
}: {
  initial?: PluginDto;
  onInstalled: (plugin: PluginDto) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  registryUrl?: string;
}) {
  const { t } = useTranslation();
  const e = (key: string) => t(`features.extension.${key}`);
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'url'>(initial ? 'url' : 'file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [compatibility, setCompatibility] = useState<{ checked: boolean; message: string; supported: boolean }>({
    checked: false,
    message: '',
    supported: true,
  });
  const [versionWarning, setVersionWarning] = useState(false);
  const [validation, setValidation] = useState<{ message: string; status: 'idle' | 'loading' | 'valid' | 'error' }>({
    message: '',
    status: 'idle',
  });
  useEffect(() => {
    if (!open) return;
    setUrl(initial ? String(initial.repo || pluginInstallUrl(initial)) : '');
    setFile(null);
    setMode(initial ? 'url' : 'file');
    setVersionWarning(false);
    setValidation({ message: '', status: 'idle' });
    setCompatibility({ checked: false, message: '', supported: true });
    if (initial?.astrbot_version)
      void checkPluginVersionSupport({ body: { astrbot_version: String(initial.astrbot_version) } })
        .then((response) => {
          const payload = responseData<unknown>(response);
          const data = isObject(payload) ? payload : {};
          setCompatibility({
            checked: true,
            message: String(data.message || data.reason || ''),
            supported: data.supported !== false,
          });
        })
        .catch(() => undefined);
  }, [initial, open]);
  const install = async (ignoreVersionCheck = false) => {
    if ((mode === 'file' && !file) || (mode === 'url' && !url.trim())) {
      toast.warning(e('messages.fillUrlOrFile'));
      return;
    }
    if (mode === 'url' && compatibility.checked && !compatibility.supported && !ignoreVersionCheck) {
      setVersionWarning(true);
      return;
    }
    setInstalling(true);
    try {
      let response: unknown;
      const proxy = getSelectedGitHubProxy();
      if (mode === 'file') {
        const body = { file: file!, ignore_version_check: ignoreVersionCheck };
        response = await installPluginFromUpload({ body });
      } else {
        if (!initial?.download_url && !initial && /^https:\/\/github\.com\//i.test(url.trim())) {
          setValidation({ message: e('messages.validatingPlugin'), status: 'loading' });
          try {
            const validationResponse = await validatePluginRepo({ body: { proxy, url: url.trim() } });
            const envelope: JsonObject = isObject(validationResponse.data) ? validationResponse.data : {};
            if (envelope.status === 'error')
              throw new Error(String(envelope.message || e('messages.pluginValidateFailed')));
            setValidation({
              message: String(envelope.message || e('messages.pluginValidateSuccess')),
              status: 'valid',
            });
          } catch (cause) {
            setValidation({ message: errorMessage(cause, e('messages.pluginValidateFailed')), status: 'error' });
            throw cause;
          }
        }
        const downloadUrl = typeof initial?.download_url === 'string' ? initial.download_url : undefined;
        const source = {
          download_url: downloadUrl,
          ignore_version_check: ignoreVersionCheck,
          install_method: initial ? 'market' : undefined,
          market_plugin_id: initial ? String(initial.market_plugin_id || '') || undefined : undefined,
          proxy: downloadUrl ? '' : proxy,
          registry_url: initial ? registryUrl || null : undefined,
        };
        response =
          !downloadUrl && /^https:\/\/github\.com\//i.test(url.trim())
            ? await installPluginFromGithub({ body: { ...source, repository: url.trim() } })
            : await installPluginFromUrl({ body: { ...source, url: url.trim() } });
      }
      const envelope = isObject((response as { data?: unknown } | null)?.data)
        ? (response as { data: JsonObject }).data
        : {};
      if (
        envelope.status === 'warning' &&
        isObject(envelope.data) &&
        envelope.data.warning_type === 'astrbot_version_unsupported'
      ) {
        setCompatibility({
          checked: true,
          message: String(envelope.message || e('dialogs.versionSupport.message')),
          supported: false,
        });
        setVersionWarning(true);
        await onInstalled({});
        return;
      }
      if (envelope.status === 'error') throw new Error(String(envelope.message || e('messages.installFailed')));
      toast.success(String(envelope.message || e('messages.addSuccess')));
      onOpenChange(false);
      await onInstalled(isObject(envelope.data) ? envelope.data : {});
    } catch (cause) {
      toast.error(errorMessage(cause, e('messages.installFailed')));
    } finally {
      setInstalling(false);
    }
  };
  const platforms = initial && Array.isArray(initial.support_platforms) ? initial.support_platforms.map(String) : [];
  const usesGithub = mode === 'url' && !initial?.download_url && /^https:\/\/github\.com\//i.test(url.trim());
  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open} title={e('dialogs.install.title')}>
        {initial ? (
          <div className="market-install-confirm">
            <header>
              {Boolean(initial.logo) ? <img alt="" src={String(initial.logo)} /> : <MdiIcon name="mdi-puzzle" />}
              <div>
                <h3>{pluginTitle(initial)}</h3>
                {Boolean(pluginAuthor(initial)) && (
                  <p>
                    {e('detail.info.author')}: {pluginAuthor(initial)}
                  </p>
                )}
              </div>
            </header>
            {Boolean(pluginDescription(initial)) && (
              <section>
                <strong>{e('table.headers.description')}</strong>
                <p>{pluginDescription(initial)}</p>
              </section>
            )}
            <div className="market-install-confirm__chips">
              {Boolean(initial.astrbot_version) && (
                <span>
                  {e('card.status.astrbotVersion')}: {String(initial.astrbot_version)}
                </span>
              )}
              {platforms.length > 0 && (
                <span>
                  {e('card.status.supportPlatform')}: {platforms.join(', ')}
                </span>
              )}
            </div>
            {compatibility.checked && !compatibility.supported && (
              <div className="extension-warning">
                <MdiIcon name="mdi-alert" />
                {compatibility.message || e('dialogs.versionSupport.message')}
              </div>
            )}
            <section>
              <strong>{e('dialogs.install.sectionTitle')}</strong>
              <small>{e('dialogs.install.downloadSource')}</small>
              <code>{String(initial.download_url || initial.repo || '')}</code>
            </section>
            {!initial.download_url && (
              <>
                <div className="extension-warning">
                  <MdiIcon name="mdi-alert-outline" />
                  {e('dialogs.install.githubSecurityWarning')}
                </div>
                <ProxySelector />
              </>
            )}
          </div>
        ) : (
          <>
            <nav className="extension-subtabs">
              <button aria-pressed={mode === 'file'} onClick={() => setMode('file')} type="button">
                {e('dialogs.install.fromFile')}
              </button>
              <button aria-pressed={mode === 'url'} onClick={() => setMode('url')} type="button">
                {e('dialogs.install.fromUrl')}
              </button>
            </nav>
            <div className="extension-install-form">
              {mode === 'file' ? (
                <>
                  <input
                    accept=".zip,application/zip"
                    hidden
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
                    ref={input}
                    type="file"
                  />
                  <button onClick={() => input.current?.click()} type="button">
                    <MdiIcon name="mdi-file-upload" />
                    {file?.name || e('buttons.selectFile')}
                  </button>
                  <small>{e('messages.supportedFormats')}</small>
                </>
              ) : (
                <label>
                  {e('upload.enterUrl')}
                  <input
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setValidation({ message: '', status: 'idle' });
                    }}
                    placeholder="https://github.com/..."
                    value={url}
                  />
                </label>
              )}
            </div>
            {usesGithub && (
              <div className="extension-warning">
                <MdiIcon name="mdi-alert-outline" />
                {e('dialogs.install.githubSecurityWarning')}
              </div>
            )}
            {mode === 'url' && <ProxySelector />}
            {validation.status !== 'idle' && (
              <div className={`extension-validation is-${validation.status}`}>
                <MdiIcon
                  className={validation.status === 'loading' ? 'mdi-spin' : undefined}
                  name={
                    validation.status === 'loading'
                      ? 'mdi-loading'
                      : validation.status === 'valid'
                        ? 'mdi-check-circle'
                        : 'mdi-alert-circle'
                  }
                />
                {validation.message}
              </div>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button onClick={() => onOpenChange(false)} type="button">
            {e('buttons.cancel')}
          </button>
          <button className="button--primary" disabled={installing} onClick={() => void install()} type="button">
            {installing ? e('messages.installing') : e('buttons.install')}
          </button>
        </div>
      </Dialog>
      <Dialog onOpenChange={setVersionWarning} open={versionWarning} title={e('dialogs.versionSupport.title')}>
        <div className="extension-warning">
          <MdiIcon name="mdi-alert" />
          <div>
            <strong>{e('dialogs.versionSupport.message')}</strong>
            <p>{compatibility.message}</p>
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={() => setVersionWarning(false)} type="button">
            {e('dialogs.versionSupport.cancel')}
          </button>
          <button
            className="button--warning"
            onClick={() => {
              setVersionWarning(false);
              void install(true);
            }}
            type="button"
          >
            {e('dialogs.versionSupport.confirm')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
