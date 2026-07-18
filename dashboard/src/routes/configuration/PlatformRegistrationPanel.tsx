import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { registerBotType } from '@/api/openapi';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { DEFAULT_FEISHU_DOMAIN } from '@/config/defaults';
import { errorMessage, type JsonObject, responseData } from './model';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type RegistrationFlow = JsonObject & { status: string };

const resultKeys = [
  'app_id',
  'app_secret',
  'appid',
  'secret',
  'domain',
  'weixin_oc_token',
  'weixin_oc_account_id',
  'weixin_oc_base_url',
  'client_id',
  'client_secret',
] as const;

export function PlatformRegistrationPanel({
  config,
  onChange,
  t,
  type,
}: {
  config: JsonObject;
  onChange: (config: JsonObject) => void;
  t: Translate;
  type: string;
}) {
  const [flow, setFlow] = useState<RegistrationFlow>({ status: 'idle' });
  const [qrImage, setQrImage] = useState('');
  const pollTimer = useRef<number | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const stopPolling = () => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    stopPolling();
    setFlow({ status: 'starting' });

    const applyResult = (data: JsonObject) => {
      const next = { ...configRef.current };
      resultKeys.forEach((key) => {
        if (data[key] !== undefined) next[key] = data[key];
      });
      onChange(next);
    };
    const payload = (action: 'start' | 'poll', extra: JsonObject = {}) => ({
      action,
      platform_config: { ...configRef.current, domain: configRef.current.domain || DEFAULT_FEISHU_DOMAIN },
      ...extra,
    });
    const poll = async (current: RegistrationFlow) => {
      if (cancelled || !current.registration_code) return;
      try {
        const data =
          responseData<JsonObject>(
            await registerBotType({
              path: { bot_type: type },
              body: payload('poll', {
                registration_code: current.registration_code,
                ...(current.task_id ? { task_id: current.task_id } : {}),
                ...(current.bind_key ? { bind_key: current.bind_key } : {}),
              }),
            }),
          ) ?? {};
        if (cancelled) return;
        const next: RegistrationFlow = { ...current, ...data, status: String(data.status || 'error') };
        setFlow(next);
        if (next.status === 'created') {
          applyResult(data);
          return;
        }
        if (next.status === 'pending' || next.status === 'slow_down') {
          const interval = Math.max(Number(next.interval || 5) + (next.status === 'slow_down' ? 5 : 0), 1);
          pollTimer.current = window.setTimeout(() => void poll({ ...next, interval }), interval * 1000);
        }
      } catch (cause) {
        if (!cancelled)
          setFlow({ ...current, status: 'error', message: errorMessage(cause, t('registrationAction.pollFailed')) });
      }
    };
    const start = async () => {
      try {
        const data =
          responseData<JsonObject>(await registerBotType({ path: { bot_type: type }, body: payload('start') })) ?? {};
        if (cancelled) return;
        const next: RegistrationFlow = { ...data, status: String(data.status || 'pending') };
        setFlow(next);
        if (next.status === 'created') applyResult(data);
        else if (next.registration_code && next.status === 'pending') {
          const interval = Math.max(Number(next.interval || 5), 1);
          pollTimer.current = window.setTimeout(() => void poll(next), interval * 1000);
        }
      } catch (cause) {
        if (!cancelled) setFlow({ status: 'error', message: errorMessage(cause, t('registrationAction.startFailed')) });
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [type]); // Registration restarts only when the selected platform flow changes.

  const qrValue = String(flow.verification_uri_complete || flow.qrcode_img_content || flow.qrcode || '');
  useEffect(() => {
    let cancelled = false;
    if (!qrValue) {
      setQrImage('');
      return undefined;
    }
    if (qrValue.startsWith('data:image/')) {
      setQrImage(qrValue);
      return undefined;
    }
    void QRCode.toDataURL(qrValue, { margin: 1, width: 190, errorCorrectionLevel: 'M' })
      .then((value) => {
        if (!cancelled) setQrImage(value);
      })
      .catch(() => {
        if (!cancelled) setQrImage('');
      });
    return () => {
      cancelled = true;
    };
  }, [qrValue]);

  const keyPrefix =
    type === 'weixin_oc'
      ? 'registrationAction.weixinOc.status'
      : type.startsWith('qq_official')
        ? 'registrationAction.qqOfficial.status'
        : 'registrationAction.status';
  const scanTitle =
    type === 'lark'
      ? 'registrationAction.lark.scanTitle'
      : type === 'dingtalk'
        ? 'registrationAction.dingtalk.scanTitle'
        : type === 'weixin_oc'
          ? 'registrationAction.weixinOc.scanTitle'
          : 'registrationAction.qqOfficial.scanTitle';
  const status = String(flow.status || 'idle');
  return (
    <div className="platform-registration">
      <strong>{t(scanTitle)}</strong>
      <div className={`platform-registration__qr ${status === 'created' ? 'is-created' : ''}`}>
        {qrImage ? <img alt={t(scanTitle)} src={qrImage} /> : <MdiIcon className="is-spinning" name="mdi-loading" />}
        {status === 'created' && (
          <span>
            <MdiIcon name="mdi-check" />
          </span>
        )}
      </div>
      <div className={`platform-registration__status is-${status}`}>
        <MdiIcon name={registrationStatusIcon(status)} />
        {t(`${keyPrefix}.${status}`)}
      </div>
      {Boolean(flow.message) && <p>{String(flow.message)}</p>}
    </div>
  );
}

function registrationStatusIcon(status: string): `mdi-${string}` {
  if (status === 'created') return 'mdi-check-circle';
  if (status === 'error' || status === 'denied' || status === 'expired') return 'mdi-alert-circle';
  if (status === 'starting' || status === 'pending' || status === 'slow_down') return 'mdi-timer-sand';
  return 'mdi-circle-outline';
}
