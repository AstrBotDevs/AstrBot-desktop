import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getPluginById, getPluginPageById } from '@/api/openapi';
import { isRecord } from '@/api/response';
import { pluginExtensionApi } from '@/api/services';
import { localePreference } from '@/config/preferences';
import { errorMessage, JsonObject, responseData } from '@/routes/configuration/model';

const CHANNEL = 'astrbot-plugin-page';
export function isTrustedPluginMessageOrigin(
  origin: string,
  expectedOrigin = window.location.origin,
  lockedOrigin?: string | null,
) {
  if (origin !== expectedOrigin && origin !== 'null') return false;
  return !lockedOrigin || lockedOrigin === origin;
}

export function pluginMessageTargetOrigin(lockedOrigin?: string | null) {
  return lockedOrigin && lockedOrigin !== 'null' ? lockedOrigin : '*';
}

export default function PluginPage() {
  const { t } = useTranslation();
  const { pluginName = '', pageName = '' } = useParams();
  const frame = useRef<HTMLIFrameElement>(null);
  const messageOrigin = useRef<string | null>(null);
  const [plugin, setPlugin] = useState<JsonObject>({});
  const [page, setPage] = useState<JsonObject>({});
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const post = useCallback(
    (payload: JsonObject) =>
      frame.current?.contentWindow?.postMessage(
        { channel: CHANNEL, ...payload },
        pluginMessageTargetOrigin(messageOrigin.current),
      ),
    [],
  );
  const sendContext = useCallback(
    () =>
      post({
        kind: 'context',
        context: {
          pluginName,
          displayName: plugin.display_name || plugin.name || pluginName,
          pageName,
          pageTitle: page.title || page.display_name || pageName,
          locale: localePreference.read(),
          i18n: plugin.i18n || {},
          isDark: document.documentElement.dataset.theme === 'dark',
        },
      }),
    [page, pageName, plugin, pluginName, post],
  );
  useEffect(() => {
    let active = true;
    messageOrigin.current = null;
    setLoading(true);
    setError('');
    Promise.all([
      getPluginById({ query: { plugin_id: pluginName } }),
      getPluginPageById({ query: { plugin_id: pluginName, page_name: pageName } }),
    ])
      .then(([pluginResponse, pageResponse]) => {
        if (!active) return;
        const pluginData = responseData<JsonObject>(pluginResponse) ?? {};
        const entry = responseData<JsonObject | string>(pageResponse);
        const pageData = typeof entry === 'string' ? { content_path: entry } : (entry ?? {});
        const path = pageData.content_path;
        if (typeof path !== 'string' || !path) throw new Error(t('features.extension.messages.pluginPageNotFound'));
        const url = new URL(path, window.location.origin);
        url.searchParams.set('theme', document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
        setPlugin(pluginData);
        setPage(pageData);
        setSrc(`${url.pathname}${url.search}${url.hash}`);
      })
      .catch((cause) => active && setError(errorMessage(cause, t('features.extension.messages.pluginPageLoadFailed'))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [pageName, pluginName, t]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !isTrustedPluginMessageOrigin(event.origin, window.location.origin, messageOrigin.current)
      )
        return;
      messageOrigin.current = event.origin;
      const message = isRecord(event.data) ? event.data : null;
      if (!message || message.channel !== CHANNEL) return;
      if (message.kind === 'ready') {
        sendContext();
        return;
      }
      if (message.kind !== 'request' || typeof message.requestId !== 'string') return;
      const respond = (ok: boolean, value: unknown) =>
        post({ kind: 'response', requestId: message.requestId, ok, ...(ok ? { data: value } : { error: value }) });
      void pluginExtensionApi
        .request(
          pluginName,
          message.action,
          message.endpoint,
          isRecord(message.params) ? message.params : undefined,
          message.body,
        )
        .then((data) => respond(true, data))
        .catch((cause) => respond(false, errorMessage(cause, 'Plugin bridge request failed.')));
    };
    window.addEventListener('message', listener);
    window.addEventListener('astrbot-locale-changed', sendContext);
    return () => {
      window.removeEventListener('message', listener);
      window.removeEventListener('astrbot-locale-changed', sendContext);
    };
  }, [pluginName, post, sendContext]);
  if (loading) return <div className="plugin-page-state">{t('features.extension.messages.pluginPageLoading')}</div>;
  if (error) return <div className="plugin-page-state monitor-error">{error}</div>;
  return (
    <iframe
      className="plugin-page-frame"
      onLoad={() => {
        messageOrigin.current = null;
        sendContext();
      }}
      ref={frame}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-forms allow-downloads"
      src={src}
      title={`${pluginName}: ${pageName}`}
    />
  );
}
